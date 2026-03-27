import test from "node:test";
import assert from "node:assert/strict";

import { __internal } from "../src/index.js";

test("classifyEntry blocks the repository root", () => {
  const result = __internal.classifyEntry(
    { path: "/repo", branch: "main", head: "abc123" },
    "/repo",
    "/repo",
    new Set(["main"]),
    true,
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "repository root, current worktree, protected branch");
  assert.equal(result.selectable, false);
});

test("classifyEntry marks merged non-protected worktrees as safe", () => {
  const result = __internal.classifyEntry(
    { path: "/repo/.worktrees/feature-safe", branch: "feature/safe", head: "abc123" },
    "/repo",
    "/repo",
    new Set(["main", "release/v1"]),
    true,
  );

  assert.equal(result.status, "safe");
  assert.equal(result.reason, "merged into base branch by git ancestry");
  assert.equal(result.selectable, true);
});

test("classifyEntry marks unmerged non-protected worktrees as review", () => {
  const result = __internal.classifyEntry(
    { path: "/repo/.worktrees/feature-review", branch: "feature/review", head: "abc123" },
    "/repo",
    "/repo",
    new Set(["main", "release/v1"]),
    false,
  );

  assert.equal(result.status, "review");
  assert.equal(result.reason, "not merged into base branch by git ancestry");
  assert.equal(result.selectable, true);
});

test("classifyEntry blocks protected branches outside the repository root", () => {
  const result = __internal.classifyEntry(
    { path: "/repo/.worktrees/release", branch: "release/v1", head: "abc123" },
    "/repo",
    "/repo",
    new Set(["main", "release/v1"]),
    true,
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "protected branch");
  assert.equal(result.selectable, false);
});

test("classifyToolExecution treats structured read tools as read-only", () => {
  const result = __internal.classifyToolExecution({ toolName: "read", args: { filePath: "a.txt" } });
  assert.equal(result.requiresIsolation, false);
});

test("classifyToolExecution treats write as mutating", () => {
  const result = __internal.classifyToolExecution({ toolName: "write", args: { filePath: "a.txt" } });
  assert.equal(result.requiresIsolation, true);
});

test("classifyToolExecution allows read-only git bash command", () => {
  const result = __internal.classifyToolExecution({ toolName: "bash", args: { command: "git status" } });
  assert.equal(result.requiresIsolation, false);
});

test("classifyToolExecution requires isolation for unknown tools", () => {
  const result = __internal.classifyToolExecution({ toolName: "mystery_tool", args: {} });
  assert.equal(result.requiresIsolation, true);
});
