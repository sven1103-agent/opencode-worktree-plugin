import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import pluginModule from "../src/index.js";

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

async function createEmptyRemoteRepo() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-empty-remote-"));
  const stateDir = path.join(tempRoot, "runtime-state");
  const remotePath = path.join(tempRoot, "remote.git");
  const repoPath = path.join(tempRoot, "repo");

  await execFileAsync("git", ["init", "--bare", remotePath]);
  await execFileAsync("git", ["clone", remotePath, repoPath]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Test User"]);
  await git(repoPath, ["config", "commit.gpgsign", "false"]);

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
  return pluginModule.server({
    $: createShell(repoPath),
    directory: repoPath,
  });
}

async function executeToolWithMetadata(execute, args, worktree, { sessionID = "test-session" } = {}) {
  let title = null;
  let result = null;
  const message = await execute(args, {
    metadata(input) {
      title = input?.title ?? title;
      result = input?.metadata?.result ?? result;
    },
    worktree,
    sessionID,
  });

  return { title, message, result };
}

async function runToolExecuteBeforeHook(plugin, input) {
  const output = { args: { ...(input?.args || {}) } };
  await plugin["tool.execute.before"]({
    tool: input?.tool ?? input?.toolName,
    sessionID: input?.sessionID,
    callID: input?.callID ?? "test-call",
  }, output);
  return { ...input, args: output.args };
}

async function runToolExecuteAfterHook(plugin, input) {
  const output = {
    title: input?.output?.title ?? "",
    output: input?.output?.output ?? "",
    metadata: {
      ...(input?.metadata ?? {}),
      ...(input?.result ? { result: input.result } : {}),
    },
  };
  await plugin["tool.execute.after"]({
    tool: input?.tool ?? input?.toolName,
    sessionID: input?.sessionID,
    callID: input?.callID ?? "test-call",
    args: input?.args || {},
  }, output);
  return { ...input, output };
}

async function runToolExecuteAfterHookWithOutput(plugin, input) {
  const output = await runToolExecuteAfterHook(plugin, input);
  const textOutput = typeof output?.output?.output === "string" ? output.output.output : "";
  return {
    output,
    advisoryTextParts: textOutput ? [textOutput] : [],
    advisoryMetadata: output?.output?.metadata?.advisory_cleanup_preview ?? null,
  };
}

async function runCommandExecuteBeforeHook(plugin, input) {
  const output = { parts: input?.output?.parts || [] };
  await plugin["command.execute.before"]({
    command: typeof input?.command === "string" ? input.command : input?.command?.name,
    sessionID: input?.sessionID ?? "test-session",
    arguments: input?.arguments ?? "",
  }, output);
  return { ...input, output };
}

async function runExperimentalChatSystemTransformHook(plugin, input) {
  const output = {
    system: typeof input?.system === "string" ? [input.system] : Array.isArray(input?.system) ? [...input.system] : [],
  };
  await plugin["experimental.chat.system.transform"]({
    sessionID: input?.sessionID,
    model: input?.model ?? { id: "test-model" },
  }, output);
  return { ...input, system: output.system.join("\n\n") };
}

async function createHandoffArtifact(repoPath, sessionID, handoffID, payload = {}) {
  const handoffPath = path.join(repoPath, ".opencode", "sessions", sessionID, "handoffs", `${handoffID}.json`);
  await writeFile(
    handoffPath,
    `${JSON.stringify({
      version: 1,
      kind: "implementation_plan",
      handoff_id: handoffID,
      parent_handoff_id: `${handoffID}-parent`,
      from_agent: "planner",
      to_agent: "implementer",
      created_at: "2026-03-27T00:00:00Z",
      status: "pending",
      payload,
    }, null, 2)}\n`,
  );
  return handoffPath;
}

async function createResultArtifact(repoPath, sessionID, resultID, sourceHandoffID, result = {}) {
  const resultPath = path.join(repoPath, ".opencode", "sessions", sessionID, "results", `${resultID}.json`);
  await writeFile(
    resultPath,
    `${JSON.stringify({
      version: 1,
      result_type: "implementation_summary",
      agent: "implementer",
      source_handoff_id: sourceHandoffID,
      created_at: "2026-03-27T00:00:00Z",
      status: "done",
      ...result,
    }, null, 2)}\n`,
  );
  return resultPath;
}

async function runTaskDelegationHook(plugin, { sessionID, prompt, subagent_type = "implementer" }) {
  return runToolExecuteBeforeHook(plugin, {
    toolName: "task",
    args: { prompt, subagent_type },
    sessionID,
  });
}

function withStateDirEnv(stateDir) {
  return {
    ...process.env,
    OPENCODE_WORKTREE_STATE_DIR: stateDir,
  };
}

export {
  commitFile,
  createEmptyRemoteRepo,
  createPlugin,
  createRemoteRepo,
  execFileAsync,
  executeToolWithMetadata,
  git,
  createHandoffArtifact,
  createResultArtifact,
  runToolExecuteAfterHook,
  runToolExecuteAfterHookWithOutput,
  runCommandExecuteBeforeHook,
  runExperimentalChatSystemTransformHook,
  runToolExecuteBeforeHook,
  runTaskDelegationHook,
  withStateDirEnv,
  writeFile,
};
