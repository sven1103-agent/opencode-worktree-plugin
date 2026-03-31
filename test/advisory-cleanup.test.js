import test from "node:test";
import assert from "node:assert/strict";

import { createRuntimeStateStore } from "../src/runtime/state-store.js";
import {
  createHandoffArtifact,
  createPlugin,
  createRemoteRepo,
  createResultArtifact,
  git,
  runTaskDelegationHook,
  runToolExecuteAfterHookWithOutput,
  runToolExecuteBeforeHook,
  writeFile,
} from "../test-support/helpers.js";

test("task completion emits advisory cleanup preview and persists terminal lifecycle", async () => {
  const fixture = await createRemoteRepo();
  const logs = [];
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;
  try {
    const plugin = await createPlugin(fixture.repoPath, { captureLogs: logs });
    const handoffPath = await createHandoffArtifact(fixture.repoPath, "session-advisory-1", "handoff-1");
    const delegated = await runTaskDelegationHook(plugin, {
      sessionID: "session-advisory-1",
      prompt: `Execute ${handoffPath}`,
      subagent_type: "implementer",
    });
    await createResultArtifact(fixture.repoPath, "session-advisory-1", "result-1", "handoff-1", { status: "done" });

    const output = await runToolExecuteAfterHookWithOutput(plugin, {
      toolName: "task",
      args: { prompt: delegated.args.prompt },
      sessionID: "session-advisory-1",
      output: { parts: [] },
    });

    assert.equal(typeof output.advisoryMetadata?.message, "string");
    assert.match(output.advisoryTextParts.join("\n"), /Cleanup advisory \(preview\)/);

    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    const store = createRuntimeStateStore({ stateDir: fixture.stateDir });
    const state = await store.loadSessionState(repoRoot, "session-advisory-1");
    assert.equal(state.active_task_id, null);
    assert.equal(state.tasks[0].status, "completed");
    assert.equal(logs.some((entry) => entry.event === "session_binding_cleared" && entry.reason === "completed"), true);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("blocked lifecycle persists but does not emit advisory cleanup", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;
  try {
    const plugin = await createPlugin(fixture.repoPath);
    const handoffPath = await createHandoffArtifact(fixture.repoPath, "session-advisory-2", "handoff-2");
    const delegated = await runTaskDelegationHook(plugin, {
      sessionID: "session-advisory-2",
      prompt: `Execute ${handoffPath}`,
    });
    await createResultArtifact(fixture.repoPath, "session-advisory-2", "result-2", "handoff-2", { status: "blocked", result_type: "blocked" });

    const output = await runToolExecuteAfterHookWithOutput(plugin, {
      toolName: "task",
      args: { prompt: delegated.args.prompt },
      sessionID: "session-advisory-2",
      output: { parts: [] },
    });

    assert.equal(output.advisoryMetadata, null);
    assert.equal(output.advisoryTextParts.length, 0);

    const repoRoot = await git(fixture.repoPath, ["rev-parse", "--show-toplevel"]);
    const store = createRuntimeStateStore({ stateDir: fixture.stateDir });
    const state = await store.loadSessionState(repoRoot, "session-advisory-2");
    assert.equal(state.tasks[0].status, "blocked");
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("non-task after-hook does not emit advisory cleanup spam", async () => {
  const fixture = await createRemoteRepo();
  try {
    const plugin = await createPlugin(fixture.repoPath);
    const output = await runToolExecuteAfterHookWithOutput(plugin, {
      toolName: "read",
      args: { filePath: "tracked.txt" },
      sessionID: "session-advisory-3",
      output: { parts: [] },
    });
    assert.equal(output.advisoryMetadata, null);
    assert.equal(output.advisoryTextParts.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("advisory preview marks unknown provenance for unmanaged candidates", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;
  try {
    const plugin = await createPlugin(fixture.repoPath);
    const manualPath = `${fixture.tempRoot}/external-manual`;
    await git(fixture.repoPath, ["worktree", "add", "-b", "wt/unmanaged", manualPath, "origin/release/v1"]);
    await runToolExecuteBeforeHook(plugin, {
      toolName: "write",
      args: { filePath: "tracked.txt" },
      sessionID: "session-advisory-4",
    });
    const handoffPath = await createHandoffArtifact(fixture.repoPath, "session-advisory-4", "handoff-4");
    const delegated = await runTaskDelegationHook(plugin, {
      sessionID: "session-advisory-4",
      prompt: `Execute ${handoffPath}`,
    });
    await createResultArtifact(fixture.repoPath, "session-advisory-4", "result-4", "handoff-4", { status: "done" });

    const output = await runToolExecuteAfterHookWithOutput(plugin, {
      toolName: "task",
      args: { prompt: delegated.args.prompt },
      sessionID: "session-advisory-4",
      output: { parts: [] },
    });

    assert.match(JSON.stringify(output.advisoryMetadata), /unknown|harness-managed/);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("advisory preview failures are non-fatal", async () => {
  const fixture = await createRemoteRepo();
  const logs = [];
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;
  try {
    const plugin = await createPlugin(fixture.repoPath, { captureLogs: logs });
    const handoffPath = await createHandoffArtifact(fixture.repoPath, "session-advisory-5", "handoff-5");
    const delegated = await runTaskDelegationHook(plugin, {
      sessionID: "session-advisory-5",
      prompt: `Execute ${handoffPath}`,
    });
    await createResultArtifact(fixture.repoPath, "session-advisory-5", "result-5", "handoff-5", { status: "done" });
    await git(fixture.repoPath, ["remote", "remove", "origin"]);

    const output = await runToolExecuteAfterHookWithOutput(plugin, {
      toolName: "task",
      args: { prompt: delegated.args.prompt },
      sessionID: "session-advisory-5",
      output: { parts: [] },
    });

    assert.equal(output.output?.toolName, "task");
    assert.equal(output.advisoryMetadata, null);
    assert.equal(logs.some((entry) => entry.event === "nonfatal_plugin_error" && entry.stage === "task_advisory_cleanup_preview"), true);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("malformed result artifact is non-fatal in task after-hook", async () => {
  const fixture = await createRemoteRepo();
  const logs = [];
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;
  try {
    const plugin = await createPlugin(fixture.repoPath, { captureLogs: logs });
    const handoffPath = await createHandoffArtifact(fixture.repoPath, "session-advisory-6", "handoff-6");
    const delegated = await runTaskDelegationHook(plugin, {
      sessionID: "session-advisory-6",
      prompt: `Execute ${handoffPath}`,
    });
    const resultPath = await createResultArtifact(fixture.repoPath, "session-advisory-6", "result-6", "handoff-6", { status: "done" });
    await writeFile(resultPath, "{\n");

    const output = await runToolExecuteAfterHookWithOutput(plugin, {
      toolName: "task",
      args: { prompt: delegated.args.prompt },
      sessionID: "session-advisory-6",
      output: { parts: [] },
    });

    assert.equal(output.output?.toolName, "task");
    assert.equal(output.advisoryMetadata, null);
    assert.equal(output.advisoryTextParts.length, 0);
    assert.equal(logs.some((entry) => entry.event === "nonfatal_plugin_error" && entry.stage === "task_lifecycle_inference"), true);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});
