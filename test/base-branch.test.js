import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { __internal } from "../src/index.js";
import { commitFile, createPlugin, createRemoteRepo, executeToolWithMetadata, git, writeFile } from "../test-support/helpers.js";

test("worktree_prepare checks out from configured baseBranch instead of the default branch", async () => {
  const fixture = await createRemoteRepo();
  const prev = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const { message, result: output } = await executeToolWithMetadata(
      plugin.tool.worktree_prepare.execute,
      { title: "Prepare from release" },
      fixture.repoPath,
    );

    assert.equal(output.ok, true);
    assert.equal(output.schema_version, __internal.RESULT_SCHEMA_VERSION);
    assert.equal(output.title, "Prepare from release");
    assert.equal(output.default_branch, "main");
    assert.equal(output.base_branch, "release/v1");
    assert.equal(output.base_ref, "origin/release/v1");
    assert.equal(message, output.message);
    assert.match(message, /- default branch: main/);
    assert.match(message, /- base branch: release\/v1/);
    assert.match(message, /- base ref: origin\/release\/v1/);

    const branchCommit = await git(fixture.repoPath, ["rev-parse", output.branch]);
    const releaseCommit = await git(fixture.repoPath, ["rev-parse", "origin/release/v1"]);
    const mainCommit = await git(fixture.repoPath, ["rev-parse", "origin/main"]);

    assert.equal(branchCommit, releaseCommit);
    assert.notEqual(branchCommit, mainCommit);
    assert.equal(output.base_commit, releaseCommit);
    await fs.access(output.worktree_path);
    const stateFiles = await fs.readdir(path.join(fixture.stateDir, "sessions"));
    assert.equal(stateFiles.length, 1);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = prev;
    await fixture.cleanup();
  }
});

test("worktree_cleanup previews merge state relative to configured baseBranch", async () => {
  const fixture = await createRemoteRepo();

  try {
    await git(fixture.repoPath, ["checkout", "-b", "feature/merged", "main"]);
    await commitFile(fixture.repoPath, "feature.txt", "feature\n", "feature change");
    await git(fixture.repoPath, ["checkout", "main"]);
    await git(fixture.repoPath, ["merge", "--no-ff", "feature/merged", "-m", "merge feature"]);
    await git(fixture.repoPath, ["worktree", "add", path.join(fixture.tempRoot, "feature-worktree"), "feature/merged"]);

    const plugin = await createPlugin(fixture.repoPath);
    const { message, result: output } = await executeToolWithMetadata(
      plugin.tool.worktree_cleanup.execute,
      { raw: "preview", selectors: [] },
      fixture.repoPath,
    );

    assert.equal(output.ok, true);
    assert.equal(output.schema_version, __internal.RESULT_SCHEMA_VERSION);
    assert.equal(output.mode, "preview");
    assert.equal(output.default_branch, "main");
    assert.equal(output.base_branch, "release/v1");
    assert.equal(message, output.message);
    assert.match(message, /Worktrees connected to this repository against release\/v1:/);
    assert.match(message, /feature\/merged/);
    assert.match(message, /not merged into base branch by git ancestry/);

    assert.equal(output.groups.safe.length, 0);
    assert.equal(output.groups.review.length, 1);
    assert.equal(output.groups.review[0].branch, "feature/merged");
    assert.equal(output.groups.review[0].status, "review");
    assert.equal(output.groups.review[0].reason, "not merged into base branch by git ancestry");
  } finally {
    await fixture.cleanup();
  }
});

test("worktree_cleanup apply returns structured partial success details", async () => {
  const fixture = await createRemoteRepo();
  const prev = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    await git(fixture.repoPath, ["checkout", "-b", "feature/dirty", "main"]);
    await commitFile(fixture.repoPath, "dirty.txt", "tracked\n", "dirty base");
    await git(fixture.repoPath, ["checkout", "main"]);
    const featureWorktree = path.join(fixture.tempRoot, "dirty-worktree");
    await git(fixture.repoPath, ["worktree", "add", featureWorktree, "feature/dirty"]);
    await writeFile(path.join(featureWorktree, "dirty.txt"), "modified but uncommitted\n");

    const plugin = await createPlugin(fixture.repoPath);
    const { message, result: output } = await executeToolWithMetadata(
      plugin.tool.worktree_cleanup.execute,
      { raw: "apply feature/dirty", selectors: [] },
      fixture.repoPath,
    );

    assert.equal(output.ok, true);
    assert.equal(output.schema_version, __internal.RESULT_SCHEMA_VERSION);
    assert.equal(output.mode, "apply");
    assert.deepEqual(output.requested_selectors, ["feature/dirty"]);
    assert.equal(output.removed.length, 0);
    assert.equal(output.failed.length, 1);
    assert.equal(output.failed[0].branch, "feature/dirty");
    assert.equal(output.failed[0].status, "review");
    assert.match(output.failed[0].reason, /dirty|changes|modified/i);
    assert.equal(message, output.message);
    assert.match(message, /Cleanup skipped for:/);
    await assert.rejects(fs.readdir(path.join(fixture.stateDir, "sessions")), /ENOENT/);
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = prev;
    await fixture.cleanup();
  }
});

test("worktree_cleanup apply updates runtime state for removed task", async () => {
  const fixture = await createRemoteRepo();
  const prev = process.env.OPENCODE_WORKTREE_STATE_DIR;
  process.env.OPENCODE_WORKTREE_STATE_DIR = fixture.stateDir;

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const prepared = await executeToolWithMetadata(plugin.tool.worktree_prepare.execute, { title: "state update" }, fixture.repoPath);
    await git(fixture.repoPath, ["checkout", "release/v1"]);
    await git(fixture.repoPath, ["merge", "--ff-only", prepared.result.branch]);

    const cleaned = await executeToolWithMetadata(
      plugin.tool.worktree_cleanup.execute,
      { raw: `apply ${prepared.result.branch}`, selectors: [] },
      fixture.repoPath,
    );

    assert.equal(cleaned.result.removed.length, 1);
    const stateFiles = await fs.readdir(path.join(fixture.stateDir, "sessions"));
    const stateFilePath = path.join(fixture.stateDir, "sessions", stateFiles[0]);
    const state = JSON.parse(await fs.readFile(stateFilePath, "utf8"));
    const task = state.tasks.find((item) => item.branch === prepared.result.branch);
    assert.equal(task.status, "completed");
  } finally {
    process.env.OPENCODE_WORKTREE_STATE_DIR = prev;
    await fixture.cleanup();
  }
});
