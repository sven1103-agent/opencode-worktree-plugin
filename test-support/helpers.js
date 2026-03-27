import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { WorktreeWorkflowPlugin } from "../src/index.js";

const execFileAsync = promisify(execFile);

function shellEscape(value) {
  return `'${String(value).replaceAll("'", `"'"'`)}'`;
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
  const stateDir = path.join(tempRoot, "runtime-state");
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
  await git(remotePath, ["symbolic-ref", "HEAD", "refs/heads/main"]);

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
    stateDir,
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

async function executeToolWithMetadata(execute, args, worktree) {
  let title = null;
  let result = null;
  const message = await execute(args, {
    metadata(input) {
      title = input?.title ?? title;
      result = input?.metadata?.result ?? result;
    },
    worktree,
    sessionID: "test-session",
  });

  return { title, message, result };
}

async function runToolExecuteBeforeHook(plugin, input) {
  return plugin.hooks["tool.execute.before"](input);
}

async function runToolExecuteAfterHook(plugin, input) {
  return plugin.hooks["tool.execute.after"](input);
}

function withStateDirEnv(stateDir) {
  return {
    ...process.env,
    OPENCODE_WORKTREE_STATE_DIR: stateDir,
  };
}

export {
  commitFile,
  createPlugin,
  createRemoteRepo,
  execFileAsync,
  executeToolWithMetadata,
  git,
  runToolExecuteAfterHook,
  runToolExecuteBeforeHook,
  withStateDirEnv,
  writeFile,
};
