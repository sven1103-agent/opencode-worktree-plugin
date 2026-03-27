import { tool } from "@opencode-ai/plugin";

import { createWorktreeWorkflowService, __internalService, isMissingGitRepositoryError, isMissingRemoteError } from "./core/worktree-service.js";
import { decideContinuity, inferTaskLifecycleTransition } from "./core/task-binding.js";
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
  inferTaskLifecycleTransition,
};

export const WorktreeWorkflowPlugin = async ({ $, directory }) => {
  const service = createWorktreeWorkflowService({
    directory,
    git: createGitRunner($, directory),
    stateStore: createRuntimeStateStore(),
  });

  return {
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
