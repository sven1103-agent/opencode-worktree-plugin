import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readRepoFile(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

test("wt-clean command stays a thin wrapper over package cleanup logic", async () => {
  const source = await readRepoFile("commands/wt-clean.md");

  assert.match(source, /Use the `worktree_cleanup` tool\./);
  assert.match(source, /Always pass the raw slash-command input as `raw: "\$ARGUMENTS"`\./);
  assert.match(source, /rely on the package implementation for argument normalization, config loading, preview\/apply selection, and cleanup semantics/);
  assert.doesNotMatch(source, /mode: "preview"/);
});

test("wt-new command stays a thin wrapper over package prepare logic", async () => {
  const source = await readRepoFile("commands/wt-new.md");

  assert.match(source, /Use the `worktree_prepare` tool\./);
  assert.match(source, /Call `worktree_prepare` directly with `title: "\$ARGUMENTS"`\./);
  assert.match(source, /Rely on the package implementation for config loading, base-branch resolution, and worktree creation semantics\./);
});
