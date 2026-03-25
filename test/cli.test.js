import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { __internal } from "../src/index.js";
import { parseCliArgs } from "../src/cli.js";
import { createPlugin, createRemoteRepo, execFileAsync } from "../test-support/helpers.js";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");

test("CLI wt-new emits structured JSON with --json", async () => {
  const fixture = await createRemoteRepo();

  try {
    const result = await execFileAsync("node", [cliPath, "wt-new", "CLI contract test", "--json"], {
      cwd: fixture.repoPath,
    });

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.schema_version, __internal.RESULT_SCHEMA_VERSION);
    assert.equal(output.title, "CLI contract test");
    assert.equal(output.base_branch, "release/v1");
    assert.equal(output.default_branch, "main");
  } finally {
    await fixture.cleanup();
  }
});

test("CLI wt-clean emits readable output by default", async () => {
  const fixture = await createRemoteRepo();

  try {
    const result = await execFileAsync("node", [cliPath, "wt-clean", "preview"], {
      cwd: fixture.repoPath,
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

test("CLI preview JSON stays compatible with the native plugin contract", async () => {
  const fixture = await createRemoteRepo();

  try {
    const nativePlugin = await createPlugin(fixture.repoPath);
    const nativeResult = await nativePlugin.tool.worktree_cleanup.execute(
      { raw: "preview", selectors: [] },
      { metadata() {}, worktree: fixture.repoPath },
    );

    const cliResult = await execFileAsync("node", [cliPath, "wt-clean", "preview", "--json"], {
      cwd: fixture.repoPath,
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
