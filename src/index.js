import { tool } from "@opencode-ai/plugin";
import path from "node:path";

import { createWorktreeWorkflowService, __internalService, isMissingGitRepositoryError, isMissingRemoteError } from "./core/worktree-service.js";
import { classifyToolExecution, decideContinuity, deriveTaskTitle, inferTaskLifecycleTransition } from "./core/task-binding.js";
import { createRuntimeStateStore } from "./runtime/state-store.js";

function publishStructuredResult(context, result) {
  context.metadata({ metadata: { result } });
  return result.message || JSON.stringify(result, null, 2);
}

function createGitRunner($, directory) {
  return async function git(args, options = {}) {
    const cwd = options.cwd ?? directory;
    const command = `git ${args.map((arg) => $.escape(String(arg))).join(" ")}`;
    const result = await $`${{ raw: command }}`.cwd(cwd).quiet().nothrow();
    const stdout = result.text().trim();
    const stderr = result.stderr.toString("utf8").trim();
    if (!options.allowFailure && result.exitCode !== 0) {
      throw new Error(stderr || stdout || `Git command failed: ${command}`);
    }
    return { stdout, stderr, exitCode: result.exitCode };
  };
}

export const __internal = {
  RESULT_SCHEMA_VERSION: __internalService.RESULT_SCHEMA_VERSION,
  ...__internalService,
  isMissingGitRepositoryError,
  isMissingRemoteError,
  decideContinuity,
  classifyToolExecution,
  deriveTaskTitle,
  inferTaskLifecycleTransition,
};

export const WorktreeWorkflowPlugin = async ({ $, directory }) => {
  const service = createWorktreeWorkflowService({
    directory,
    git: createGitRunner($, directory),
    stateStore: createRuntimeStateStore(),
  });

  function rewritePathIntoWorktree(value, repoRoot, worktreePath) {
    if (typeof value !== "string" || !value.trim()) return value;
    const resolved = path.resolve(value);
    const repo = path.resolve(repoRoot);
    const relative = path.relative(repo, resolved);
    const insideRepo = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (path.isAbsolute(value) && !insideRepo) return value;
    if (!path.isAbsolute(value)) return path.join(worktreePath, value);
    return path.join(worktreePath, relative);
  }

  async function onToolExecuteBefore(input) {
    const toolName = input?.tool?.name ?? input?.toolName;
    const args = input?.args || {};
    const classification = classifyToolExecution({ toolName, args });
    if (classification.bypass || !classification.requiresIsolation) return input;

    const sessionID = input?.sessionID ?? input?.context?.sessionID;
    if (!sessionID) throw new Error(`Isolation required for ${toolName || "tool"} but sessionID is missing.`);

    const repoRoot = await service.getRepoRoot();
    if (toolName === "bash" && typeof args.command === "string" && args.command.includes(path.resolve(repoRoot))) {
      throw new Error("Blocked: bash command includes repo-root absolute path that cannot be safely rewritten.");
    }

    const binding = await service.ensureActiveWorktree({
      sessionID,
      title: deriveTaskTitle({ toolName, args, sessionID }),
    });

    const nextArgs = { ...args };
    if (toolName === "bash" && nextArgs.workdir == null && nextArgs.cwd == null) {
      nextArgs.workdir = binding.task.worktree_path;
      nextArgs.cwd = binding.task.worktree_path;
    }
    for (const key of ["workdir", "cwd", "filePath"]) {
      if (key in nextArgs) {
        nextArgs[key] = rewritePathIntoWorktree(nextArgs[key], binding.repoRoot, binding.task.worktree_path);
      }
    }

    return { ...input, args: nextArgs };
  }

  async function onToolExecuteAfter(input) {
    const toolName = input?.tool?.name ?? input?.toolName;
    const sessionID = input?.sessionID ?? input?.context?.sessionID;
    if (toolName === "worktree_prepare" && sessionID) {
      const result = input?.metadata?.result ?? input?.result;
      if (result?.branch && result?.worktree_path) {
        const repoRoot = await service.getRepoRoot();
        await service.updateStateForPrepare(repoRoot, sessionID, result, "manual");
      }
    }
    if (sessionID) await service.recordToolUsage({ sessionID });
    return input;
  }

  return {
    hooks: {
      "tool.execute.before": onToolExecuteBefore,
      "tool.execute.after": onToolExecuteAfter,
    },
    tool: {
      worktree_prepare: tool({
        description: "Create a synced git worktree from a descriptive title",
        args: {
          title: tool.schema.string().min(3).describe("Descriptive working title for the new worktree"),
        },
        async execute(args, context) {
          context.metadata({ title: `Create worktree: ${args.title}` });
          const result = await service.prepare({ title: args.title, sessionID: context.sessionID });
          return publishStructuredResult(context, result);
        },
      }),
      worktree_cleanup: tool({
        description: "Preview or clean git worktrees",
        args: {
          mode: tool.schema.string().optional().describe("Preview cleanup candidates or remove them"),
          raw: tool.schema.string().optional().describe("Raw cleanup arguments from slash commands"),
          selectors: tool.schema.array(tool.schema.string()).default([]).describe("Optional branch names or worktree paths to remove explicitly"),
        },
        async execute(args, context) {
          const result = await service.cleanup({
            mode: args.mode,
            raw: args.raw,
            selectors: args.selectors,
            worktree: context.worktree,
            sessionID: context.sessionID,
          });
          context.metadata({ title: `Clean worktrees (${result.mode})` });
          return publishStructuredResult(context, result);
        },
      }),
    },
  };
};

export default WorktreeWorkflowPlugin;
