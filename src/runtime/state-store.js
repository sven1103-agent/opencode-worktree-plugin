import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STORE_VERSION = 1;

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
      if (!parsed || typeof parsed !== "object") {
        return { schema_version: STORE_VERSION, repo_root: path.resolve(repoRoot), session_id: sessionID, active_task: null, tasks: [] };
      }
      return parsed;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { schema_version: STORE_VERSION, repo_root: path.resolve(repoRoot), session_id: sessionID, active_task: null, tasks: [] };
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
    return state?.active_task ?? null;
  }

  function setActiveTask(state, activeTask) {
    return {
      ...state,
      active_task: activeTask,
    };
  }

  function upsertTask(state, taskPatch) {
    const timestamp = now();
    const tasks = Array.isArray(state?.tasks) ? [...state.tasks] : [];
    const index = tasks.findIndex((task) => task?.branch === taskPatch?.branch || task?.worktree_path === taskPatch?.worktree_path);

    if (index === -1) {
      tasks.push({
        ...taskPatch,
        created_at: timestamp,
        last_used_at: timestamp,
      });
    } else {
      const existing = tasks[index] || {};
      tasks[index] = {
        ...existing,
        ...taskPatch,
        created_at: existing.created_at || timestamp,
        last_used_at: timestamp,
      };
    }

    return {
      ...state,
      tasks,
    };
  }

  return {
    stateDir,
    loadSessionState,
    saveSessionState,
    getActiveTask,
    setActiveTask,
    upsertTask,
  };
}

export { defaultStateDir };
