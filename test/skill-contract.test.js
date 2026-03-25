import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPlugin, createRemoteRepo, execFileAsync, executeToolWithMetadata } from "../test-support/helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "src", "cli.js");
const skillPath = path.join(repoRoot, "skills", "worktree-workflow", "SKILL.md");

function decideExecutionPlan({ rootSafe, nativeToolsAvailable, cliFallbackAvailable }) {
  if (rootSafe) {
    return { action: "stay-in-root" };
  }

  if (nativeToolsAvailable) {
    return { action: "use-native-tool" };
  }

  if (cliFallbackAvailable) {
    return { action: "use-cli-fallback" };
  }

  return { action: "stop" };
}

async function readSkill() {
  return fs.readFile(skillPath, "utf8");
}

test("skill contract covers root-safe vs task-scoped decisions", async () => {
  const skill = await readSkill();

  assert.deepEqual(decideExecutionPlan({ rootSafe: true, nativeToolsAvailable: true, cliFallbackAvailable: true }), {
    action: "stay-in-root",
  });
  assert.deepEqual(decideExecutionPlan({ rootSafe: false, nativeToolsAvailable: true, cliFallbackAvailable: true }), {
    action: "use-native-tool",
  });
  assert.match(skill, /Use repo root only for tiny, root-safe tasks\./);
  assert.match(skill, /Prefer one task-scoped worktree for non-trivial editable work\./);
});

test("skill contract prefers native tools before CLI fallback", async () => {
  const skill = await readSkill();

  assert.deepEqual(decideExecutionPlan({ rootSafe: false, nativeToolsAvailable: true, cliFallbackAvailable: true }), {
    action: "use-native-tool",
  });
  assert.deepEqual(decideExecutionPlan({ rootSafe: false, nativeToolsAvailable: false, cliFallbackAvailable: true }), {
    action: "use-cli-fallback",
  });
  assert.match(skill, /Use the native worktree tools as the primary path when the native worktree tools are available\./);
  assert.match(skill, /Use the packaged CLI fallback path when the native tools are unavailable\./);
});

test("skill contract stops when isolation is needed but unavailable", async () => {
  const skill = await readSkill();

  assert.deepEqual(decideExecutionPlan({ rootSafe: false, nativeToolsAvailable: false, cliFallbackAvailable: false }), {
    action: "stop",
  });
  assert.match(skill, /Continue in repo root only for tiny, root-safe tasks when no worktree capability is available; otherwise stop and explain that isolation capability is unavailable\./);
});

test("skill -> native plugin path has a happy-path integration", async () => {
  const fixture = await createRemoteRepo();

  try {
    const plan = decideExecutionPlan({ rootSafe: false, nativeToolsAvailable: true, cliFallbackAvailable: true });
    assert.equal(plan.action, "use-native-tool");

    const plugin = await createPlugin(fixture.repoPath);
    const { message, result } = await executeToolWithMetadata(
      plugin.tool.worktree_prepare.execute,
      { title: "Native path integration" },
      fixture.repoPath,
    );

    assert.equal(result.ok, true);
    assert.equal(result.title, "Native path integration");
    assert.equal(message, result.message);
  } finally {
    await fixture.cleanup();
  }
});

test("skill -> bunx fallback path has a happy-path integration via CLI", async () => {
  const fixture = await createRemoteRepo();

  try {
    const plan = decideExecutionPlan({ rootSafe: false, nativeToolsAvailable: false, cliFallbackAvailable: true });
    assert.equal(plan.action, "use-cli-fallback");

    const result = await execFileAsync("node", [cliPath, "wt-new", "Fallback path integration", "--json"], {
      cwd: fixture.repoPath,
    });

    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.title, "Fallback path integration");
  } finally {
    await fixture.cleanup();
  }
});
