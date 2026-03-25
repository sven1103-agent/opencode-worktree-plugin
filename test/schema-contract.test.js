import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { __internal } from "../src/index.js";
import { commitFile, createPlugin, createRemoteRepo, executeToolWithMetadata, git, writeFile } from "../test-support/helpers.js";
import { assertMatchesSchema } from "../test-support/schema-assert.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readSchemaFile(fileName) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, "schemas", fileName), "utf8"));
}

test("worktree_prepare output matches checked-in schema", async () => {
  const fixture = await createRemoteRepo();

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const { message, result } = await executeToolWithMetadata(
      plugin.tool.worktree_prepare.execute,
      { title: "Schema prepare contract" },
      fixture.repoPath,
    );

    const schema = await readSchemaFile("worktree-prepare.result.schema.json");
    assertMatchesSchema(result, schema, "worktree_prepare");
    assert.equal(result.schema_version, __internal.RESULT_SCHEMA_VERSION);
    assert.equal(message, result.message);
  } finally {
    await fixture.cleanup();
  }
});

test("worktree_cleanup preview output matches checked-in schema", async () => {
  const fixture = await createRemoteRepo();

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const { message, result } = await executeToolWithMetadata(
      plugin.tool.worktree_cleanup.execute,
      { raw: "preview", selectors: [] },
      fixture.repoPath,
    );

    const schema = await readSchemaFile("worktree-cleanup-preview.result.schema.json");
    assertMatchesSchema(result, schema, "worktree_cleanup.preview");
    assert.equal(result.schema_version, __internal.RESULT_SCHEMA_VERSION);
    assert.equal(message, result.message);
  } finally {
    await fixture.cleanup();
  }
});

test("worktree_cleanup apply output matches checked-in schema during partial success", async () => {
  const fixture = await createRemoteRepo();

  try {
    await git(fixture.repoPath, ["checkout", "-b", "feature/dirty", "main"]);
    await commitFile(fixture.repoPath, "dirty.txt", "tracked\n", "dirty base");
    await git(fixture.repoPath, ["checkout", "main"]);
    const featureWorktree = path.join(fixture.tempRoot, "dirty-worktree");
    await git(fixture.repoPath, ["worktree", "add", featureWorktree, "feature/dirty"]);
    await writeFile(path.join(featureWorktree, "dirty.txt"), "modified but uncommitted\n");

    const plugin = await createPlugin(fixture.repoPath);
    const { message, result } = await executeToolWithMetadata(
      plugin.tool.worktree_cleanup.execute,
      { raw: "apply feature/dirty", selectors: [] },
      fixture.repoPath,
    );

    const schema = await readSchemaFile("worktree-cleanup-apply.result.schema.json");
    assertMatchesSchema(result, schema, "worktree_cleanup.apply");
    assert.equal(result.failed.length, 1);
    assert.equal(result.removed.length, 0);
    assert.equal(result.failed[0].selector, "feature/dirty");
    assert.equal(message, result.message);
  } finally {
    await fixture.cleanup();
  }
});
