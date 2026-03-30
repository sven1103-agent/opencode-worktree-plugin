import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRuntimeStateStore, defaultStateDir } from "../src/runtime/state-store.js";

test("defaultStateDir prefers OPENCODE_WORKTREE_STATE_DIR", () => {
  const dir = defaultStateDir({ OPENCODE_WORKTREE_STATE_DIR: "/tmp/override" }, "linux");
  assert.equal(dir, path.resolve("/tmp/override"));
});

test("runtime store saves and loads session state atomically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wt-state-store-"));
  try {
    const store = createRuntimeStateStore({ stateDir: root });
    const sessionState = await store.loadSessionState("/repo/path", "session-1");
    const next = store.upsertTask(sessionState, { branch: "wt/task", worktree_path: "/tmp/wt/task", status: "active" });
    await store.saveSessionState("/repo/path", "session-1", next);
    const loaded = await store.loadSessionState("/repo/path", "session-1");
    assert.equal(Array.isArray(loaded.tasks), true);
    assert.equal(loaded.tasks.length, 1);
    assert.equal(loaded.tasks[0].branch, "wt/task");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("upsertTask preserves created_at and refreshes last_used_at", () => {
  let tick = 0;
  const store = createRuntimeStateStore({ stateDir: "/tmp/unused", now: () => `2026-03-27T00:00:0${++tick}Z` });
  const first = store.upsertTask({ tasks: [] }, { branch: "wt/a", worktree_path: "/tmp/a", status: "active" });
  const second = store.upsertTask(first, { branch: "wt/a", status: "completed" });
  assert.equal(second.tasks[0].created_at, "2026-03-27T00:00:01Z");
  assert.equal(second.tasks[0].last_used_at, "2026-03-27T00:00:02Z");
  assert.equal(second.tasks[0].status, "completed");
});

test("setActiveTask enforces single-active invariant", () => {
  const store = createRuntimeStateStore({ stateDir: "/tmp/unused" });
  const withA = store.upsertTask({ tasks: [] }, { task_id: "wt/a", branch: "wt/a", status: "active" });
  const withB = store.upsertTask(withA, { task_id: "wt/b", branch: "wt/b", status: "inactive" });
  const activatedB = store.setActiveTask(withB, "wt/b");

  assert.equal(store.getActiveTask(activatedB), "wt/b");
  assert.equal(activatedB.tasks.find((task) => task.task_id === "wt/a")?.status, "inactive");
  assert.equal(activatedB.tasks.find((task) => task.task_id === "wt/b")?.status, "active");
});

test("runtime store supports active record lookup and touch", () => {
  let tick = 0;
  const store = createRuntimeStateStore({ stateDir: "/tmp/unused", now: () => `2026-03-27T00:00:0${++tick}Z` });
  const withTask = store.upsertTask({ tasks: [] }, { task_id: "wt/x", branch: "wt/x", worktree_path: "/tmp/x", status: "active" });
  const active = store.setActiveTask(withTask, "wt/x");
  const record = store.getActiveTaskRecord(active);
  assert.equal(record?.task_id, "wt/x");
  const touched = store.touchTask(active, "wt/x");
  assert.equal(touched.tasks[0].last_used_at, "2026-03-27T00:00:02Z");
  assert.equal(store.findTaskByWorktreePath(touched, "/tmp/x")?.task_id, "wt/x");
});

test("loadSessionState migrates legacy active_task and cleaned status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wt-state-store-legacy-"));
  try {
    const store = createRuntimeStateStore({ stateDir: root });
    const legacy = {
      schema_version: 1,
      repo_root: "/repo/path",
      session_id: "session-legacy",
      active_task: "wt/task",
      tasks: [{ branch: "wt/task", worktree_path: "/tmp/wt/task", status: "cleaned" }],
    };
    await store.saveSessionState("/repo/path", "session-legacy", legacy);

    const loaded = await store.loadSessionState("/repo/path", "session-legacy");
    assert.equal(loaded.active_task_id, null);
    assert.equal(loaded.tasks[0].task_id, "wt/task");
    assert.equal(loaded.tasks[0].status, "completed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("upsertTask preserves title and workspace_role metadata", () => {
  const store = createRuntimeStateStore({ stateDir: "/tmp/unused" });
  const first = store.upsertTask({ tasks: [] }, { task_id: "wt/meta", branch: "wt/meta", title: "Meta Task", workspace_role: "reviewer" });
  const second = store.upsertTask(first, { task_id: "wt/meta", status: "active" });
  assert.equal(second.tasks[0].title, "Meta Task");
  assert.equal(second.tasks[0].workspace_role, "reviewer");
});

test("upsertTask preserves existing created_by when patch omits it", () => {
  const store = createRuntimeStateStore({ stateDir: "/tmp/unused" });
  const first = store.upsertTask({ tasks: [] }, { task_id: "wt/provenance", branch: "wt/provenance", created_by: "harness" });
  const second = store.upsertTask(first, { task_id: "wt/provenance", status: "active" });
  assert.equal(second.tasks[0].created_by, "harness");
});

test("loadSessionState normalizes missing or invalid created_by to manual", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wt-state-store-created-by-"));
  try {
    const store = createRuntimeStateStore({ stateDir: root });
    await store.saveSessionState("/repo/path", "session-created-by", {
      schema_version: 1,
      repo_root: "/repo/path",
      session_id: "session-created-by",
      active_task_id: null,
      tasks: [
        { task_id: "wt/a", branch: "wt/a" },
        { task_id: "wt/b", branch: "wt/b", created_by: "unknown" },
      ],
    });

    const loaded = await store.loadSessionState("/repo/path", "session-created-by");
    assert.equal(loaded.tasks.find((task) => task.task_id === "wt/a")?.created_by, "manual");
    assert.equal(loaded.tasks.find((task) => task.task_id === "wt/b")?.created_by, "manual");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("listRepoSessionStates and listRepoTasks enumerate repo-scoped entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wt-state-store-list-"));
  try {
    const store = createRuntimeStateStore({ stateDir: root });
    const baseOne = await store.loadSessionState("/repo/path", "session-one");
    const baseTwo = await store.loadSessionState("/repo/path", "session-two");
    const baseOther = await store.loadSessionState("/other/repo", "session-other");
    const one = store.upsertTask(baseOne, { task_id: "wt/one", branch: "wt/one", worktree_path: "/tmp/one", created_by: "harness", status: "active" });
    const two = store.upsertTask(baseTwo, { task_id: "wt/two", branch: "wt/two", worktree_path: "/tmp/two", created_by: "manual", status: "inactive" });
    const other = store.upsertTask(baseOther, { task_id: "wt/other", branch: "wt/other", worktree_path: "/tmp/other", created_by: "manual", status: "inactive" });
    await store.saveSessionState("/repo/path", "session-one", store.setActiveTask(one, "wt/one"));
    await store.saveSessionState("/repo/path", "session-two", two);
    await store.saveSessionState("/other/repo", "session-other", other);

    const sessions = await store.listRepoSessionStates("/repo/path");
    const tasks = await store.listRepoTasks("/repo/path");

    assert.equal(sessions.length, 2);
    assert.equal(tasks.some((task) => task.task_id === "wt/one" && task.active === true), true);
    assert.equal(tasks.some((task) => task.task_id === "wt/two" && task.session_id === "session-two"), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
