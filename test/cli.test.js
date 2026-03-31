import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { __internal } from "../src/index.js";
import { isInvokedAsScript, parseCliArgs } from "../src/cli.js";
import { createEmptyRemoteRepo, createPlugin, createRemoteRepo, execFileAsync, executeToolWithMetadata, withStateDirEnv } from "../test-support/helpers.js";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");

test("CLI wt-new emits structured JSON with --json", async () => {
  const fixture = await createRemoteRepo();

  try {
    const result = await execFileAsync("node", [cliPath, "wt-new", "CLI contract test", "--json"], {
      cwd: fixture.repoPath,
      env: withStateDirEnv(fixture.stateDir),
    });

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.schema_version, __internal.RESULT_SCHEMA_VERSION);
    assert.equal(output.title, "CLI contract test");
    assert.equal(output.base_branch, "release/v1");
    assert.equal(output.default_branch, "main");
    const stateFiles = await fs.readdir(path.join(fixture.stateDir, "sessions"));
    assert.equal(stateFiles.length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI wt-clean emits readable output by default", async () => {
  const fixture = await createRemoteRepo();

  try {
    const result = await execFileAsync("node", [cliPath, "wt-clean", "preview"], {
      cwd: fixture.repoPath,
      env: withStateDirEnv(fixture.stateDir),
    });

    assert.match(result.stdout, /Worktrees connected to this repository against release\/v1:/);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI wt-clean emits structured JSON with --json", async () => {
  const fixture = await createRemoteRepo();

  try {
    const result = await execFileAsync("node", [cliPath, "wt-clean", "preview", "--json"], {
      cwd: fixture.repoPath,
      env: withStateDirEnv(fixture.stateDir),
    });

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.schema_version, __internal.RESULT_SCHEMA_VERSION);
    assert.equal(output.mode, "preview");
    assert.equal(output.base_branch, "release/v1");
    assert.ok(Array.isArray(output.groups.safe));
    assert.ok(Array.isArray(output.groups.review));
    assert.ok(Array.isArray(output.groups.blocked));
  } finally {
    await fixture.cleanup();
  }
});

test("CLI parseCliArgs strips --json and preserves command arguments", () => {
  assert.deepEqual(parseCliArgs(["wt-clean", "apply", "feature/foo", "--json"]), {
    outputJson: true,
    args: ["wt-clean", "apply", "feature/foo"],
  });
});

test("CLI entrypoint detection resolves symlinked bin paths", async () => {
  const dir = await fs.mkdtemp(path.join(path.dirname(cliPath), "cli-bin-test-"));

  try {
    const symlinkPath = path.join(dir, "opencode-worktree-workflow");
    await fs.symlink(cliPath, symlinkPath);

    assert.equal(isInvokedAsScript(cliPath), true);
    assert.equal(isInvokedAsScript(symlinkPath), true);
    assert.equal(isInvokedAsScript(path.join(dir, "missing-bin")), false);
    assert.equal(isInvokedAsScript(undefined), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("CLI preview JSON stays compatible with the native plugin contract", async () => {
  const fixture = await createRemoteRepo();

  try {
    const nativePlugin = await createPlugin(fixture.repoPath);
    const { result: nativeResult } = await executeToolWithMetadata(
      nativePlugin.tool.worktree_cleanup.execute,
      { raw: "preview", selectors: [] },
      fixture.repoPath,
    );

    const cliResult = await execFileAsync("node", [cliPath, "wt-clean", "preview", "--json"], {
      cwd: fixture.repoPath,
      env: withStateDirEnv(fixture.stateDir),
    });

    const cliOutput = JSON.parse(cliResult.stdout);

    assert.equal(cliOutput.schema_version, nativeResult.schema_version);
    assert.equal(cliOutput.mode, nativeResult.mode);
    assert.equal(cliOutput.default_branch, nativeResult.default_branch);
    assert.equal(cliOutput.base_branch, nativeResult.base_branch);
    assert.equal(cliOutput.base_ref, nativeResult.base_ref);
    assert.deepEqual(Object.keys(cliOutput.groups), Object.keys(nativeResult.groups));
    assert.equal(cliOutput.groups.safe.length, nativeResult.groups.safe.length);
    assert.equal(cliOutput.groups.review.length, nativeResult.groups.review.length);
    assert.equal(cliOutput.groups.blocked.length, nativeResult.groups.blocked.length);
    assert.deepEqual(Object.keys(cliOutput.groups.blocked[0]).sort(), Object.keys(nativeResult.groups.blocked[0]).sort());
  } finally {
    await fixture.cleanup();
  }
});

test("CLI --help prints usage", async () => {
  const fixture = await createRemoteRepo();

  try {
    const result = await execFileAsync("node", [cliPath, "--help"], {
      cwd: fixture.repoPath,
    });

    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /wt-new <title>/);
    assert.match(result.stdout, /wt-clean \[preview\|apply\]/);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI wt-clean --help prints subcommand usage", async () => {
  const fixture = await createRemoteRepo();

  try {
    const result = await execFileAsync("node", [cliPath, "wt-clean", "--help"], {
      cwd: fixture.repoPath,
    });

    assert.match(result.stdout, /wt-clean \[preview\|apply\]/);
    assert.match(result.stdout, /Preview connected worktrees/);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI surfaces an actionable error outside a git repository", async () => {
  const fixture = await createRemoteRepo();

  try {
    const outsideRepo = path.join(fixture.tempRoot, "outside-repo");
    await fs.mkdir(outsideRepo, { recursive: true });

    await assert.rejects(
      execFileAsync("node", [cliPath, "wt-clean", "preview"], { cwd: outsideRepo }),
      /must run inside a git repository/i,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("CLI surfaces an actionable error when the configured remote is missing", async () => {
  const fixture = await createRemoteRepo();

  try {
    await execFileAsync("git", ["remote", "remove", "origin"], { cwd: fixture.repoPath });

    await assert.rejects(
      execFileAsync("node", [cliPath, "wt-clean", "preview"], { cwd: fixture.repoPath }),
      /Could not fetch base branch information from remote "origin"/i,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("CLI surfaces an actionable error when the remote has no base branch yet", async () => {
  const fixture = await createEmptyRemoteRepo();

  try {
    await assert.rejects(
      execFileAsync("node", [cliPath, "wt-clean", "preview"], { cwd: fixture.repoPath }),
      /does not have branch "main" yet/i,
    );
  } finally {
    await fixture.cleanup();
  }
});
