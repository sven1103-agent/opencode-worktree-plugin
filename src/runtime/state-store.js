import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STORE_VERSION = 1;

const LIFECYCLE_VALUES = new Set(["active", "inactive", "completed", "blocked"]);
const WORKSPACE_ROLES = new Set(["linear-flow", "planner", "implementer", "reviewer"]);
const CREATED_BY_VALUES = new Set(["manual", "harness"]);

function normalizeLifecycleStatus(value) {
  if (value === "cleaned") return "completed";
  return LIFECYCLE_VALUES.has(value) ? value : "inactive";
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeWorkspaceRole(value) {
  return WORKSPACE_ROLES.has(value) ? value : "linear-flow";
}

function normalizeCreatedBy(value, fallback = "manual") {
  if (CREATED_BY_VALUES.has(value)) return value;
  return CREATED_BY_VALUES.has(fallback) ? fallback : "manual";
}

function createDefaultState(repoRoot, sessionID) {
  return {
    schema_version: STORE_VERSION,
    repo_root: path.resolve(repoRoot),
    session_id: sessionID,
    active_task_id: null,
    tasks: [],
  };
}

function findTaskIndex(tasks, taskPatch) {
  if (taskPatch?.task_id) {
    const byID = tasks.findIndex((task) => task?.task_id === taskPatch.task_id);
    if (byID !== -1) return byID;
  }

  return tasks.findIndex((task) => {
    if (taskPatch?.branch && task?.branch === taskPatch.branch) return true;
    if (taskPatch?.worktree_path && task?.worktree_path === taskPatch.worktree_path) return true;
    return false;
  });
}

function normalizeLoadedState(parsed, repoRoot, sessionID) {
  if (!parsed || typeof parsed !== "object") return createDefaultState(repoRoot, sessionID);

  const state = createDefaultState(repoRoot, sessionID);
  const incomingTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const legacyActiveTask = typeof parsed.active_task === "string" && parsed.active_task ? parsed.active_task : null;
  const declaredActiveTask = typeof parsed.active_task_id === "string" && parsed.active_task_id ? parsed.active_task_id : null;

  state.tasks = incomingTasks.map((task, index) => {
    const normalized = {
      ...(task && typeof task === "object" ? task : {}),
      task_id: task?.task_id || task?.branch || task?.worktree_path || `task-${index + 1}`,
      status: normalizeLifecycleStatus(task?.status),
      title: normalizeOptionalString(task?.title),
      workspace_role: normalizeWorkspaceRole(task?.workspace_role),
      created_by: normalizeCreatedBy(task?.created_by),
    };
    return normalized;
  });

  let activeTaskID = declaredActiveTask;
  if (!activeTaskID && legacyActiveTask) {
    const legacyMatch = state.tasks.find((task) => task.task_id === legacyActiveTask || task.branch === legacyActiveTask);
    activeTaskID = legacyMatch?.task_id ?? null;
  }
  if (!activeTaskID) {
    const activeFromStatus = state.tasks.find((task) => task.status === "active");
    activeTaskID = activeFromStatus?.task_id ?? null;
  }
  if (activeTaskID) {
    const activeTask = state.tasks.find((task) => task.task_id === activeTaskID);
    if (!activeTask || activeTask.status === "completed" || activeTask.status === "blocked") {
      activeTaskID = null;
    }
  }

  state.active_task_id = activeTaskID;
  if (activeTaskID) {
    state.tasks = state.tasks.map((task) => {
      if (task.status === "completed" || task.status === "blocked") return task;
      return {
        ...task,
        status: task.task_id === activeTaskID ? "active" : "inactive",
      };
    });
  } else {
    state.tasks = state.tasks.map((task) => {
      if (task.status === "active") return { ...task, status: "inactive" };
      return task;
    });
  }

  return state;
}

function defaultStateDir(env = process.env, platform = process.platform) {
  if (env.OPENCODE_WORKTREE_STATE_DIR) {
    return path.resolve(env.OPENCODE_WORKTREE_STATE_DIR);
  }

  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "opencode-worktree-workflow");
  }

  if (platform === "win32") {
    const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "opencode-worktree-workflow");
  }

  const xdgState = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(xdgState, "opencode-worktree-workflow");
}

function getSessionFilePath(baseDir, repoRoot, sessionID) {
  const key = `${path.resolve(repoRoot)}::${sessionID}`;
  const digest = crypto.createHash("sha256").update(key).digest("hex");
  return path.join(baseDir, "sessions", `${digest}.json`);
}

async function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export function createRuntimeStateStore({ stateDir = defaultStateDir(), now = () => new Date().toISOString() } = {}) {
  async function loadSessionState(repoRoot, sessionID) {
    const filePath = getSessionFilePath(stateDir, repoRoot, sessionID);

    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeLoadedState(parsed, repoRoot, sessionID);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return createDefaultState(repoRoot, sessionID);
      }
      throw error;
    }
  }

  async function saveSessionState(repoRoot, sessionID, state) {
    const filePath = getSessionFilePath(stateDir, repoRoot, sessionID);
    await atomicWriteJson(filePath, state);
    return filePath;
  }

  function getActiveTask(state) {
    return state?.active_task_id ?? null;
  }

  function findTaskByID(state, taskID) {
    if (!taskID) return null;
    return (Array.isArray(state?.tasks) ? state.tasks : []).find((task) => task?.task_id === taskID) ?? null;
  }

  function findTaskByWorktreePath(state, worktreePath) {
    if (!worktreePath) return null;
    const resolved = path.resolve(worktreePath);
    return (Array.isArray(state?.tasks) ? state.tasks : []).find((task) => task?.worktree_path && path.resolve(task.worktree_path) === resolved) ?? null;
  }

  function getActiveTaskRecord(state) {
    return findTaskByID(state, getActiveTask(state));
  }

  function setActiveTask(state, activeTaskID) {
    const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
    const nextTasks = tasks.map((task) => {
      if (!task || typeof task !== "object") return task;
      if (task.status === "completed" || task.status === "blocked") return task;
      if (!activeTaskID) {
        return task.status === "active" ? { ...task, status: "inactive" } : task;
      }
      return {
        ...task,
        status: task.task_id === activeTaskID ? "active" : "inactive",
      };
    });

    return {
      ...state,
      active_task_id: activeTaskID,
      tasks: nextTasks,
    };
  }

  function upsertTask(state, taskPatch) {
    const timestamp = now();
    const tasks = Array.isArray(state?.tasks) ? [...state.tasks] : [];
    const index = findTaskIndex(tasks, taskPatch);

    if (index === -1) {
      tasks.push({
        ...taskPatch,
        task_id: taskPatch?.task_id || taskPatch?.branch || taskPatch?.worktree_path || `task-${tasks.length + 1}`,
        status: normalizeLifecycleStatus(taskPatch?.status),
        title: normalizeOptionalString(taskPatch?.title),
        workspace_role: normalizeWorkspaceRole(taskPatch?.workspace_role),
        created_by: normalizeCreatedBy(taskPatch?.created_by),
        created_at: timestamp,
        last_used_at: timestamp,
      });
    } else {
      const existing = tasks[index] || {};
      tasks[index] = {
        ...existing,
        ...taskPatch,
        task_id: existing.task_id || taskPatch?.task_id || taskPatch?.branch || taskPatch?.worktree_path || `task-${index + 1}`,
        status: normalizeLifecycleStatus(taskPatch?.status ?? existing.status),
        title: normalizeOptionalString(taskPatch?.title) ?? normalizeOptionalString(existing.title),
        workspace_role: normalizeWorkspaceRole(taskPatch?.workspace_role ?? existing.workspace_role),
        created_by: normalizeCreatedBy(taskPatch?.created_by, existing.created_by),
        created_at: existing.created_at || timestamp,
        last_used_at: timestamp,
      };
    }

    return {
      ...state,
      tasks,
    };
  }

  function touchTask(state, taskID) {
    const timestamp = now();
    const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
    return {
      ...state,
      tasks: tasks.map((task) => (task?.task_id === taskID ? { ...task, last_used_at: timestamp } : task)),
    };
  }

  return {
    stateDir,
    loadSessionState,
    saveSessionState,
    getActiveTask,
    getActiveTaskRecord,
    findTaskByID,
    findTaskByWorktreePath,
    setActiveTask,
    upsertTask,
    touchTask,
  };
}

export { defaultStateDir };
