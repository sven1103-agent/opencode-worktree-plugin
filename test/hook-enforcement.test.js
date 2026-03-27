import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createRuntimeStateStore } from "../src/runtime/state-store.js";
import { createPlugin, createRemoteRepo, executeToolWithMetadata, git, runToolExecuteAfterHook, runToolExecuteBeforeHook } from "../test-support/helpers.js";

test("tool.execute.before provisions worktree and rewrites mutating filePath", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const output = await runToolExecuteBeforeHook(plugin, {
      toolName: "write",
      args: { filePath: "tracked.txt" },
      sessionID: "hook-session-1",
    });

    assert.notEqual(output.args.filePath, "tracked.txt");
    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    const store = createRuntimeStateStore({ stateDir: fixture.stateDir });
    const state = await store.loadSessionState(repoRoot, "hook-session-1");
    assert.equal(state.tasks[0].created_by, "harness");
    const sessionsDir = path.join(fixture.stateDir, "sessions");
    const files = await fs.readdir(sessionsDir);
    assert.equal(files.length, 1);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("tool.execute.before keeps read-only tools in repo root", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const output = await runToolExecuteBeforeHook(plugin, {
      toolName: "read",
      args: { filePath: "tracked.txt" },
      sessionID: "hook-session-2",
    });
    assert.equal(output.args.filePath, "tracked.txt");
    await assert.rejects(fs.readdir(path.join(fixture.stateDir, "sessions")), /ENOENT/);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("tool.execute.before blocks mutating call without sessionID", async () => {
  const fixture = await createRemoteRepo();
  try {
    const plugin = await createPlugin(fixture.repoPath);
    await assert.rejects(
      runToolExecuteBeforeHook(plugin, { toolName: "write", args: { filePath: "tracked.txt" } }),
      /sessionID is missing/i,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("tool.execute.before blocks opaque repo-root paths in bash command", async () => {
  const fixture = await createRemoteRepo();
  try {
    const plugin = await createPlugin(fixture.repoPath);
    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    await assert.rejects(
      runToolExecuteBeforeHook(plugin, {
        toolName: "bash",
        args: { command: `python ${path.join(repoRoot, "script.py")}` },
        sessionID: "hook-session-3",
      }),
      /cannot be safely rewritten/i,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("tool.execute.before defaults mutating bash workdir/cwd to active worktree", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const output = await runToolExecuteBeforeHook(plugin, {
      toolName: "bash",
      args: { command: "touch tracked.txt" },
      sessionID: "hook-session-5",
    });

    assert.ok(typeof output.args.workdir === "string" && output.args.workdir.length > 0);
    assert.equal(output.args.workdir, output.args.cwd);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("tool.execute.before does not rewrite absolute sibling-prefix paths", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    const siblingPath = `${repoRoot}-sibling/tracked.txt`;
    const output = await runToolExecuteBeforeHook(plugin, {
      toolName: "write",
      args: { filePath: siblingPath },
      sessionID: "hook-session-6",
    });

    assert.equal(output.args.filePath, siblingPath);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("tool.execute.after adopts manual prepare result into session state", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const { result } = await executeToolWithMetadata(
      plugin.tool.worktree_prepare.execute,
      { title: "Manual prepare state adoption" },
      fixture.repoPath,
    );

    await runToolExecuteAfterHook(plugin, {
      toolName: "worktree_prepare",
      result,
      sessionID: "hook-session-4",
    });

    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    const store = createRuntimeStateStore({ stateDir: fixture.stateDir });
    const state = await store.loadSessionState(repoRoot, "hook-session-4");
    assert.equal(state.active_task_id, result.branch);
    assert.equal(state.tasks[0].created_by, "manual");
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});
