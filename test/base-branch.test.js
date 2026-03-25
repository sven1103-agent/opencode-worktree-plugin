import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { WorktreeWorkflowPlugin } from "../src/index.js";

const execFileAsync = promisify(execFile);

function shellEscape(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function createShell(cwdBase) {
  const shell = (strings, ...values) => {
    const [firstValue] = values;
    const raw = firstValue?.raw || strings.raw?.join("") || strings.join("");
    let cwd = cwdBase;

    return {
      cwd(nextCwd) {
        cwd = nextCwd;
        return this;
      },
      quiet() {
        return this;
      },
      async nothrow() {
        try {
          const result = await execFileAsync("sh", ["-lc", raw], { cwd });
          return {
            text() {
              return result.stdout;
            },
            stderr: Buffer.from(result.stderr),
            exitCode: 0,
          };
        } catch (error) {
          return {
            text() {
              return error.stdout || "";
            },
            stderr: Buffer.from(error.stderr || ""),
            exitCode: typeof error.code === "number" ? error.code : 1,
          };
        }
      },
    };
  };

  shell.escape = shellEscape;
  return shell;
}

async function git(repoPath, args) {
  const result = await execFileAsync("git", args, { cwd: repoPath });
  return result.stdout.trim();
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function commitFile(repoPath, fileName, content, message) {
  await writeFile(path.join(repoPath, fileName), content);
  await git(repoPath, ["add", fileName]);
  await git(repoPath, ["commit", "-m", message]);
}

async function createRemoteRepo() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-base-branch-"));
  const remotePath = path.join(tempRoot, "remote.git");
  const repoPath = path.join(tempRoot, "repo");

  await execFileAsync("git", ["init", "--bare", remotePath]);
  await execFileAsync("git", ["clone", remotePath, repoPath]);
  await git(repoPath, ["checkout", "-b", "main"]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Test User"]);
  await git(repoPath, ["config", "commit.gpgsign", "false"]);

  await commitFile(repoPath, "tracked.txt", "main-1\n", "main init");
  await git(repoPath, ["push", "-u", "origin", "main"]);

  await git(repoPath, ["checkout", "-b", "release/v1"]);
  await commitFile(repoPath, "tracked.txt", "release-1\n", "release change");
  await git(repoPath, ["push", "-u", "origin", "release/v1"]);

  await git(repoPath, ["checkout", "main"]);
  await commitFile(repoPath, "tracked.txt", "main-2\n", "main change");
  await git(repoPath, ["push"]);

  await writeFile(
    path.join(repoPath, ".opencode", "worktree-workflow.json"),
    JSON.stringify({ baseBranch: "release/v1" }, null, 2),
  );

  return {
    tempRoot,
    repoPath,
    async cleanup() {
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function createPlugin(repoPath) {
  return WorktreeWorkflowPlugin({
    $: createShell(repoPath),
    directory: repoPath,
  });
}

function parseOutputValue(output, key) {
  const line = output.split("\n").find((entry) => entry.startsWith(`- ${key}: `));
  return line ? line.slice(key.length + 4) : null;
}

test("worktree_prepare checks out from configured baseBranch instead of the default branch", async () => {
  const fixture = await createRemoteRepo();

  try {
    const plugin = await createPlugin(fixture.repoPath);
    const output = await plugin.tool.worktree_prepare.execute(
      { title: "Prepare from release" },
      { metadata() {}, worktree: fixture.repoPath },
    );

    assert.match(output, /- default branch: main/);
    assert.match(output, /- base branch: release\/v1/);
    assert.match(output, /- base ref: origin\/release\/v1/);

    const createdBranch = parseOutputValue(output, "branch");
    const worktreePath = parseOutputValue(output, "worktree");
    const branchCommit = await git(fixture.repoPath, ["rev-parse", createdBranch]);
    const releaseCommit = await git(fixture.repoPath, ["rev-parse", "origin/release/v1"]);
    const mainCommit = await git(fixture.repoPath, ["rev-parse", "origin/main"]);

    assert.equal(branchCommit, releaseCommit);
    assert.notEqual(branchCommit, mainCommit);
    await fs.access(worktreePath);
  } finally {
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
    const output = await plugin.tool.worktree_cleanup.execute(
      { raw: "preview", selectors: [] },
      { metadata() {}, worktree: fixture.repoPath },
    );

    assert.match(output, /Worktrees connected to this repository against release\/v1:/);
    assert.match(output, /feature\/merged/);
    assert.match(output, /not merged into base branch by git ancestry/);
  } finally {
    await fixture.cleanup();
  }
});
