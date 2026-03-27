import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createHandoffArtifact, createPlugin, createRemoteRepo, runTaskDelegationHook } from "../test-support/helpers.js";

test("task delegation enriches referenced handoff before delegation", async () => {
  const fixture = await createRemoteRepo();
  const previous = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;
  try {
    const plugin = await createPlugin(fixture.repoPath);
    const handoffPath = await createHandoffArtifact(fixture.repoPath, "session-a", "handoff-a");
    const relativeHandoffPath = path.relative(fixture.repoPath, handoffPath);
    const output = await runTaskDelegationHook(plugin, {
      sessionID: "session-a",
      prompt: `Execute ${relativeHandoffPath}`,
      subagent_type: "implementer",
    });
    const handoff = JSON.parse(await fs.readFile(handoffPath, "utf8"));
    assert.equal(handoff.payload.workspace_role, "implementer");
    assert.equal(handoff.payload.lifecycle_state, "active");
    assert.ok(typeof handoff.payload.worktree_path === "string" && handoff.payload.worktree_path.length > 0);
    assert.match(output.args.prompt, /Workspace binding:/);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = previous;
    await fixture.cleanup();
  }
});

test("task delegation fails closed without safe handoff artifact path", async () => {
  const fixture = await createRemoteRepo();
  try {
    const plugin = await createPlugin(fixture.repoPath);
    await assert.rejects(
      runTaskDelegationHook(plugin, {
        sessionID: "session-b",
        prompt: "Execute this task without artifact path",
      }),
      /must reference a safe handoff artifact path/i,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("task delegation rejects sibling-prefix absolute handoff paths", async () => {
  const fixture = await createRemoteRepo();
  try {
    const plugin = await createPlugin(fixture.repoPath);
    const siblingPrefixPath = path.join(
      `${fixture.repoPath}-sibling`,
      ".opencode",
      "sessions",
      "session-c",
      "handoffs",
      "handoff-c.json",
    );
    await assert.rejects(
      runTaskDelegationHook(plugin, {
        sessionID: "session-c",
        prompt: `Execute ${siblingPrefixPath}`,
      }),
      /must reference a safe handoff artifact path/i,
    );
  } finally {
    await fixture.cleanup();
  }
});
