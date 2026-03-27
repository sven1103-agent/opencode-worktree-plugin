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
