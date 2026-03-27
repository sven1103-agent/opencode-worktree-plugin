export function decideContinuity({ hasActiveTask = false, continuationSignal = false, distinctObjectiveSignal = false, alternativeRequested = false, ambiguous = false } = {}) {
  if (!hasActiveTask) {
    return { decision: "create-new", reason: "no-active-task" };
  }

  if (distinctObjectiveSignal || alternativeRequested) {
    return { decision: "create-new", reason: alternativeRequested ? "alternative-requested" : "distinct-objective" };
  }

  if (ambiguous) {
    return { decision: "ask-user", reason: "ambiguous-continuity" };
  }

  if (continuationSignal) {
    return { decision: "reuse-active", reason: "clear-continuation" };
  }

  return { decision: "ask-user", reason: "insufficient-signal" };
}

export function inferTaskLifecycleTransition({ currentStatus = "inactive", explicitSignal = "none" } = {}) {
  if (explicitSignal === "activate") return "active";
  if (explicitSignal === "deactivate") return "inactive";
  if (explicitSignal === "complete") return "completed";
  if (explicitSignal === "block") return "blocked";
  return currentStatus;
}

const READ_ONLY_TOOLS = new Set(["read", "glob", "grep", "webfetch"]);
const WORKTREE_CONTROL_TOOLS = new Set(["worktree_prepare", "worktree_cleanup"]);
const MUTATING_TOOLS = new Set(["write", "edit", "apply_patch"]);
const WORKSPACE_ROLES = new Set(["planner", "implementer", "reviewer", "linear-flow"]);
const READ_ONLY_GIT_COMMAND = /^\s*git\s+(status|diff|log|show|rev-parse|symbolic-ref|branch\s+--show-current|remote\s+show)\b/i;

export function classifyToolExecution({ toolName, args = {} } = {}) {
  const name = typeof toolName === "string" ? toolName : "";
  if (WORKTREE_CONTROL_TOOLS.has(name)) return { requiresIsolation: false, bypass: true, kind: "worktree-control" };
  if (READ_ONLY_TOOLS.has(name)) return { requiresIsolation: false, bypass: false, kind: "read-only" };
  if (name === "task") return { requiresIsolation: true, bypass: false, kind: "delegation" };
  if (MUTATING_TOOLS.has(name)) return { requiresIsolation: true, bypass: false, kind: "mutating" };
  if (name === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    if (READ_ONLY_GIT_COMMAND.test(command)) return { requiresIsolation: false, bypass: false, kind: "read-only" };
    return { requiresIsolation: true, bypass: false, kind: "mutating" };
  }
  return { requiresIsolation: true, bypass: false, kind: "unknown" };
}

export function deriveTaskTitle({ explicitTitle, toolName, args = {}, sessionID } = {}) {
  if (typeof explicitTitle === "string" && explicitTitle.trim()) return explicitTitle.trim();
  if (typeof args.title === "string" && args.title.trim()) return args.title.trim();
  if (typeof args.prompt === "string" && args.prompt.trim()) return args.prompt.trim().slice(0, 80);
  if (typeof args.description === "string" && args.description.trim()) return args.description.trim().slice(0, 80);
  const shortID = typeof sessionID === "string" && sessionID ? sessionID.slice(0, 8) : "auto";
  if (typeof toolName === "string" && toolName) return `${toolName}-${shortID}`;
  return `task-${shortID}`;
}

export function deriveWorkspaceRole({ subagentType } = {}) {
  if (typeof subagentType !== "string") return "linear-flow";
  const normalized = subagentType.trim().toLowerCase();
  return WORKSPACE_ROLES.has(normalized) ? normalized : "linear-flow";
}

export function extractHandoffArtifactPath(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) return null;
  const match = prompt.match(/(?:^|\s)(\/?[^\s]*\.opencode\/sessions\/[A-Za-z0-9_-]+\/handoffs\/[A-Za-z0-9._-]+\.json)(?:\s|$)/);
  return match?.[1] ?? null;
}

export function buildWorkspaceContext({ task, workspaceRole } = {}) {
  return {
    task_id: task?.task_id ?? null,
    task_title: task?.title ?? null,
    worktree_path: task?.worktree_path ?? null,
    workspace_role: workspaceRole || "linear-flow",
    lifecycle_state: task?.status ?? "active",
  };
}
