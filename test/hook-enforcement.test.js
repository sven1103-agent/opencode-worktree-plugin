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

test("tool.execute.before rewrites read-only structured args when active binding exists", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    await runToolExecuteBeforeHook(plugin, {
      toolName: "write",
      args: { filePath: "tracked.txt" },
      sessionID: "hook-session-read-rewrite",
    });
    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    const output = await runToolExecuteBeforeHook(plugin, {
      toolName: "read",
      args: { filePath: path.join(repoRoot, "tracked.txt") },
      sessionID: "hook-session-read-rewrite",
    });
    assert.notEqual(output.args.filePath, path.join(repoRoot, "tracked.txt"));
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

test("tool.execute.before blocks opaque repo-root paths in apply_patch patch text", async () => {
  const fixture = await createRemoteRepo();
  try {
    const plugin = await createPlugin(fixture.repoPath);
    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    await assert.rejects(
      runToolExecuteBeforeHook(plugin, {
        toolName: "apply_patch",
        args: { patchText: `*** Begin Patch\n*** Update File: ${path.join(repoRoot, "tracked.txt")}\n*** End Patch` },
        sessionID: "hook-session-opaque-patch",
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

test("tool.execute.before defaults read-only bash workdir/cwd to active worktree", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    await runToolExecuteBeforeHook(plugin, {
      toolName: "write",
      args: { filePath: "tracked.txt" },
      sessionID: "hook-session-readonly-bash-default",
    });
    const output = await runToolExecuteBeforeHook(plugin, {
      toolName: "bash",
      args: { command: "git status" },
      sessionID: "hook-session-readonly-bash-default",
    });
    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    const store = createRuntimeStateStore({ stateDir: fixture.stateDir });
    const state = await store.loadSessionState(repoRoot, "hook-session-readonly-bash-default");
    const worktreePath = state.tasks[0].worktree_path;

    assert.equal(output.args.workdir, worktreePath);
    assert.equal(output.args.workdir, output.args.cwd);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("tool.execute.before does not provision for read-only bash without binding", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const output = await runToolExecuteBeforeHook(plugin, {
      toolName: "bash",
      args: { command: "git status" },
      sessionID: "hook-session-readonly-bash-no-binding",
    });

    assert.equal(output.args.workdir, undefined);
    assert.equal(output.args.cwd, undefined);
    await assert.rejects(fs.readdir(path.join(fixture.stateDir, "sessions")), /ENOENT/);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("tool.execute.before defaults glob/grep path to active worktree", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    await runToolExecuteBeforeHook(plugin, {
      toolName: "write",
      args: { filePath: "tracked.txt" },
      sessionID: "hook-session-readonly-path-default",
    });

    const globOutput = await runToolExecuteBeforeHook(plugin, {
      toolName: "glob",
      args: { pattern: "**/*.txt" },
      sessionID: "hook-session-readonly-path-default",
    });
    const grepOutput = await runToolExecuteBeforeHook(plugin, {
      toolName: "grep",
      args: { pattern: "tracked" },
      sessionID: "hook-session-readonly-path-default",
    });
    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    const store = createRuntimeStateStore({ stateDir: fixture.stateDir });
    const state = await store.loadSessionState(repoRoot, "hook-session-readonly-path-default");
    const worktreePath = state.tasks[0].worktree_path;

    assert.equal(globOutput.args.path, worktreePath);
    assert.equal(grepOutput.args.path, worktreePath);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("tool.execute.before does not provision for glob/grep without binding", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const globOutput = await runToolExecuteBeforeHook(plugin, {
      toolName: "glob",
      args: { pattern: "**/*.txt" },
      sessionID: "hook-session-readonly-path-no-binding",
    });
    const grepOutput = await runToolExecuteBeforeHook(plugin, {
      toolName: "grep",
      args: { pattern: "tracked" },
      sessionID: "hook-session-readonly-path-no-binding",
    });

    assert.equal(globOutput.args.path, undefined);
    assert.equal(grepOutput.args.path, undefined);
    await assert.rejects(fs.readdir(path.join(fixture.stateDir, "sessions")), /ENOENT/);
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
