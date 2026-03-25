import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("co-shipped worktree skill stays policy-focused and runtime-agnostic", async () => {
  const source = await fs.readFile(path.join(repoRoot, "skills", "worktree-workflow.md"), "utf8");

  assert.match(source, /name: worktree-workflow/);
  assert.match(source, /task-scoped worktrees/i);
  assert.match(source, /native worktree tools are available/);
  assert.match(source, /CLI fallback path/);
  assert.match(source, /cleanup is preview-first/i);
  assert.doesNotMatch(source, /\.opencode\/sessions\//);
  assert.doesNotMatch(source, /workspace\.json/i);
});
