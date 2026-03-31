import { tool } from "@opencode-ai/plugin";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { createWorktreeWorkflowService, __internalService, isMissingGitRepositoryError, isMissingRemoteError } from "./core/worktree-service.js";
import {
  buildWorkspaceContext,
  buildWtCleanCommandPromptParts,
  buildWtNewCommandPromptParts,
  classifyToolExecution,
  decideContinuity,
  deriveTaskTitle,
  deriveWorkspaceRole,
  extractHandoffArtifactPath,
  getToolRewritePolicy,
  hasOpaqueRepoRootAbsoluteReference,
  inferTaskLifecycleTransition,
  rewriteRepoScopedPathIntoWorktree,
} from "./core/task-binding.js";
import { createDecisionLogger } from "./runtime/decision-logger.js";
import { createRuntimeStateStore } from "./runtime/state-store.js";

function publishStructuredResult(context, result) {
  context.metadata({ metadata: { result } });
  return result.message || JSON.stringify(result, null, 2);
}

const WORKSPACE_SYSTEM_CONTEXT_MARKER = "Active workspace context:";

function formatWorkspaceSystemContext(workspaceContext) {
  return [
    WORKSPACE_SYSTEM_CONTEXT_MARKER,
    `- task_id: ${workspaceContext.task_id}`,
    `- task_title: ${workspaceContext.task_title}`,
    `- worktree_path: ${workspaceContext.worktree_path}`,
    "Policy: operate within this worktree for repository actions.",
  ].join("\n");
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

function resolveSafeHandoffPath({ rawPath, repoRoot, directory }) {
  if (typeof rawPath !== "string" || !rawPath.trim()) return null;
  const candidate = path.resolve(path.isAbsolute(rawPath) ? rawPath : path.join(directory, rawPath));
  const normalized = candidate.split(path.sep).join("/");
  const safePattern = /\/\.opencode\/sessions\/[A-Za-z0-9_-]+\/handoffs\/[A-Za-z0-9._-]+\.json$/;
  if (!safePattern.test(normalized)) return null;
  const base = path.resolve(repoRoot);
  const canonicalBase = (() => {
    try {
      return realpathSync(base);
    } catch {
      return base;
    }
  })();
  const canonicalCandidate = (() => {
    try {
      return realpathSync(candidate);
    } catch {
      return candidate;
    }
  })();
  const relative = path.relative(canonicalBase, canonicalCandidate);
  const insideRepo = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (!insideRepo) return null;
  return canonicalCandidate;
}

async function enrichHandoffArtifact(filePath, workspaceContext) {
  const source = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(source);
  const payload = parsed && typeof parsed === "object" && typeof parsed.payload === "object" ? parsed.payload : {};
  const next = {
    ...parsed,
    payload: {
      ...payload,
      ...workspaceContext,
    },
  };
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function inferLifecycleSignalFromResultArtifact(resultArtifact) {
  const status = typeof resultArtifact?.status === "string" ? resultArtifact.status : "";
  const resultType = typeof resultArtifact?.result_type === "string" ? resultArtifact.result_type : "";
  if (status === "blocked" || resultType === "blocked") return "block";
  if (status === "done" || resultType === "implementation_summary") return "complete";
  return null;
}

async function resolveTaskResultLifecycleSignal(handoffPath) {
  const handoff = await readJsonIfExists(handoffPath);
  if (!handoff || typeof handoff !== "object") return null;
  const handoffID = typeof handoff.handoff_id === "string" ? handoff.handoff_id : null;
  if (!handoffID) return null;
  const sessionDir = path.dirname(path.dirname(handoffPath));
  const resultsDir = path.join(sessionDir, "results");
  let resultFiles = [];
  try {
    resultFiles = await fs.readdir(resultsDir);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  const candidates = [];
  for (const fileName of resultFiles) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = path.join(resultsDir, fileName);
    const artifact = await readJsonIfExists(filePath);
    if (!artifact || artifact.source_handoff_id !== handoffID) continue;
    const signal = inferLifecycleSignalFromResultArtifact(artifact);
    if (!signal) continue;
    candidates.push({ filePath, artifact, signal });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aCreated = typeof a.artifact?.created_at === "string" ? a.artifact.created_at : "";
    const bCreated = typeof b.artifact?.created_at === "string" ? b.artifact.created_at : "";
    return aCreated.localeCompare(bCreated);
  });
  const latest = candidates[candidates.length - 1];
  return {
    signal: latest.signal,
    handoff,
    result_artifact_path: latest.filePath,
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
  deriveWorkspaceRole,
  extractHandoffArtifactPath,
  buildWorkspaceContext,
  inferTaskLifecycleTransition,
  getToolRewritePolicy,
  rewriteRepoScopedPathIntoWorktree,
  hasOpaqueRepoRootAbsoluteReference,
};

export const pluginID = "@sven1103/opencode-worktree-workflow";

export const WorktreeWorkflowPlugin = async ({ $, directory, logger: providedLogger = null }) => {
  const logger = providedLogger || createDecisionLogger();
  const service = createWorktreeWorkflowService({
    directory,
    git: createGitRunner($, directory),
    stateStore: createRuntimeStateStore(),
    logger,
  });

  async function onToolExecuteBefore(input, output) {
    const toolName = input?.tool;
    const args = output?.args || {};
    const classification = classifyToolExecution({ toolName, args });
    if (classification.bypass) return;
    const rewritePolicy = getToolRewritePolicy({ toolName });

    const sessionID = input?.sessionID;
    let binding = null;
    let repoRootForLogging = null;

    if (classification.requiresIsolation) {
      if (!sessionID) throw new Error(`Isolation required for ${toolName || "tool"} but sessionID is missing.`);
      const repoRoot = await service.getRepoRoot();
      repoRootForLogging = repoRoot;
      for (const key of rewritePolicy.opaqueArgKeys) {
        if (hasOpaqueRepoRootAbsoluteReference({ value: args[key], repoRoot })) {
          logger.info("tool_path_rewrite_skipped", { tool: toolName, arg_key: key, reason: "opaque-repo-root-reference", session_id: sessionID });
          throw new Error(`Blocked: ${toolName} ${key} includes repo-root absolute path that cannot be safely rewritten.`);
        }
      }
      binding = await service.ensureActiveWorktree({
        sessionID,
        title: deriveTaskTitle({ toolName, args, sessionID }),
        workspaceRole: deriveWorkspaceRole({ subagentType: args.subagent_type }),
      });
    } else if (sessionID) {
      const repoRoot = await service.getRepoRoot();
      repoRootForLogging = repoRoot;
      const { activeTask } = await service.getSessionBinding({ repoRoot, sessionID });
      if (activeTask?.worktree_path) binding = { repoRoot, task: activeTask };
    }

    if (!binding) {
      for (const key of rewritePolicy.pathArgKeys) {
        const hasArg = key in args;
        logger.info("tool_path_rewrite_skipped", {
          tool: toolName,
          arg_key: key,
          reason: hasArg ? "no-active-binding" : "arg-missing",
          session_id: sessionID,
        });
      }
      return;
    }

    if (toolName === "task") {
      const handoffPath = resolveSafeHandoffPath({
        rawPath: extractHandoffArtifactPath(args.prompt),
        repoRoot: binding.repoRoot,
        directory,
      });
      if (!handoffPath) {
        throw new Error("Blocked: Task delegation prompt must reference a safe handoff artifact path.");
      }
      const workspaceContext = buildWorkspaceContext({ task: binding.task, workspaceRole: deriveWorkspaceRole({ subagentType: args.subagent_type }) });
      await enrichHandoffArtifact(handoffPath, workspaceContext);
      output.args = {
        ...args,
        prompt: `${args.prompt}\n\nWorkspace binding:\n- task_id: ${workspaceContext.task_id}\n- worktree_path: ${workspaceContext.worktree_path}\n- workspace_role: ${workspaceContext.workspace_role}`,
      };
      return;
    }

    const nextArgs = { ...args };
    if (toolName === "bash" && nextArgs.workdir == null && nextArgs.cwd == null) {
      nextArgs.workdir = binding.task.worktree_path;
      nextArgs.cwd = binding.task.worktree_path;
    }
    if ((toolName === "glob" || toolName === "grep") && nextArgs.path == null) {
      nextArgs.path = binding.task.worktree_path;
    }
    for (const key of rewritePolicy.pathArgKeys) {
      if (!(key in nextArgs)) {
        logger.info("tool_path_rewrite_skipped", { tool: toolName, arg_key: key, reason: "arg-missing", session_id: sessionID, task_id: binding.task.task_id });
        continue;
      }
      const before = nextArgs[key];
      const after = rewriteRepoScopedPathIntoWorktree({
        value: nextArgs[key],
        repoRoot: binding.repoRoot,
        worktreePath: binding.task.worktree_path,
      });
      nextArgs[key] = after;
      if (before !== after) {
        logger.info("tool_path_rewrite_applied", { tool: toolName, arg_key: key, session_id: sessionID, task_id: binding.task.task_id });
        logger.debug("tool_path_rewrite_applied", {
          tool: toolName,
          arg_key: key,
          session_id: sessionID,
          task_id: binding.task.task_id,
          before_path: typeof before === "string" ? before : String(before),
          after_path: typeof after === "string" ? after : String(after),
        });
        continue;
      }
      let reason = "outside-repo-root";
      if (typeof before === "string" && before.trim()) {
        const resolved = path.resolve(before);
        const inWorktree = (() => {
          const relative = path.relative(path.resolve(binding.task.worktree_path), resolved);
          return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
        })();
        if (inWorktree) reason = "already-in-worktree";
      }
      logger.info("tool_path_rewrite_skipped", { tool: toolName, arg_key: key, reason, session_id: sessionID, task_id: binding.task.task_id, repo_root_known: Boolean(repoRootForLogging) });
    }

    output.args = nextArgs;
  }

  async function onToolExecuteAfter(input, output) {
    const toolName = input?.tool;
    const args = input?.args || {};
    const sessionID = input?.sessionID;
    if (toolName === "worktree_prepare" && sessionID) {
      const result = output?.metadata?.result;
      if (result?.branch && result?.worktree_path) {
        const repoRoot = await service.getRepoRoot();
        await service.updateStateForPrepare(repoRoot, sessionID, result, "manual");
      }
    }
    if (toolName === "task" && sessionID) {
      const repoRoot = await service.getRepoRoot();
      const handoffPath = resolveSafeHandoffPath({
        rawPath: extractHandoffArtifactPath(args.prompt),
        repoRoot,
        directory,
      });
      if (handoffPath) {
        try {
          const lifecycle = await resolveTaskResultLifecycleSignal(handoffPath);
          if (lifecycle?.signal) {
            const persisted = await service.recordTaskLifecycleSignal({
              repoRoot,
              sessionID,
              taskID: lifecycle.handoff?.payload?.task_id,
              worktreePath: lifecycle.handoff?.payload?.worktree_path,
              signal: lifecycle.signal,
            });
            if (persisted && lifecycle.signal === "complete") {
              try {
                const advisory = await service.buildCleanupAdvisoryPreview({ repoRoot, activeWorktree: directory });
                await service.recordToolUsage({ sessionID });
                output.output = output.output ? `${output.output}\n\n${advisory.message}` : advisory.message;
                output.metadata = {
                  ...(output?.metadata && typeof output.metadata === "object" ? output.metadata : {}),
                  advisory_cleanup_preview: advisory,
                };
                return;
              } catch {
                logger.info("nonfatal_plugin_error", { stage: "task_advisory_cleanup_preview", session_id: sessionID, message: "Cleanup advisory preview failed." });
                // Advisory preview is non-fatal.
              }
            }
          }
        } catch {
          logger.info("nonfatal_plugin_error", { stage: "task_lifecycle_inference", session_id: sessionID, message: "Task lifecycle correlation failed." });
          // Artifact correlation/lifecycle inference is non-fatal.
        }
      }
    }
    if (sessionID) await service.recordToolUsage({ sessionID });
  }

  async function onCommandExecuteBefore(input, output) {
    const normalizedName = typeof input?.command === "string" ? input.command.replace(/^\//, "") : "";
    if (normalizedName !== "wt-new" && normalizedName !== "wt-clean") return;

    const argsText = typeof input?.arguments === "string" ? input.arguments : "";
    const parts = normalizedName === "wt-new" ? buildWtNewCommandPromptParts(argsText) : buildWtCleanCommandPromptParts(argsText);
    output.parts = parts;
  }

  async function onExperimentalChatSystemTransform(input, output) {
    const sessionID = input?.sessionID;
    const existingSystem = Array.isArray(output?.system) ? output.system : [];
    if (!sessionID || existingSystem.some((entry) => entry.includes(WORKSPACE_SYSTEM_CONTEXT_MARKER))) return;

    const repoRoot = await service.getRepoRoot();
    const { activeTask } = await service.getSessionBinding({ repoRoot, sessionID });
    if (!activeTask?.worktree_path) return;

    const workspaceContext = buildWorkspaceContext({
      task: activeTask,
      workspaceRole: activeTask.workspace_role,
    });
    const injected = formatWorkspaceSystemContext(workspaceContext);
    output.system = [...existingSystem, injected];
  }

  return {
    "command.execute.before": onCommandExecuteBefore,
    "experimental.chat.system.transform": onExperimentalChatSystemTransform,
    "tool.execute.before": onToolExecuteBefore,
    "tool.execute.after": onToolExecuteAfter,
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

const plugin = {
  id: pluginID,
  server: WorktreeWorkflowPlugin,
};

export default plugin;
