import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "jsonc-parser";
import { tool } from "@opencode-ai/plugin";

const DEFAULTS = {
  branchPrefix: "wt/",
  remote: "origin",
  worktreeRoot: ".worktrees/$REPO",
  cleanupMode: "preview",
  protectedBranches: [],
};

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }

  const source = await fs.readFile(filePath, "utf8");
  const data = parse(source);
  return data && typeof data === "object" ? data : null;
}

function normalizeBranchPrefix(prefix) {
  if (!prefix) {
    return "";
  }

  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function slugifyTitle(title) {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function formatRootTemplate(template, repoRoot) {
  const repoName = path.basename(repoRoot);
  return template
    .replaceAll("$REPO", repoName)
    .replaceAll("$ROOT", repoRoot)
    .replaceAll("$ROOT_PARENT", path.dirname(repoRoot));
}

function parseShortBranch(branchRef) {
  const prefix = "refs/heads/";
  return branchRef.startsWith(prefix) ? branchRef.slice(prefix.length) : branchRef;
}

function parseWorktreeList(output) {
  const entries = [];
  let current = null;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }

    if (line.startsWith("worktree ")) {
      if (current) {
        entries.push(current);
      }
      current = { path: line.slice("worktree ".length) };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
      continue;
    }

    if (line.startsWith("branch ")) {
      current.branchRef = line.slice("branch ".length);
      current.branch = parseShortBranch(current.branchRef);
      continue;
    }

    if (line === "detached") {
      current.detached = true;
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

function formatPreview(candidates, defaultBranch) {
  if (candidates.length === 0) {
    return [
      `No merged worktrees are ready for cleanup against ${defaultBranch}.`,
      "",
      "Use `/wt-clean apply` after merged branches appear here.",
    ].join("\n");
  }

  return [
    `Merged worktrees ready for cleanup against ${defaultBranch}:`,
    ...candidates.map(
      (candidate) =>
        `- ${candidate.branch} -> ${candidate.path}${candidate.head ? ` (${candidate.head.slice(0, 12)})` : ""}`,
    ),
    "",
    "Run `/wt-clean apply` to remove these worktrees and delete their local branches.",
  ].join("\n");
}

function formatCleanupSummary(defaultBranch, removed, failed) {
  const lines = [`Cleaned worktrees merged into ${defaultBranch}:`];

  if (removed.length === 0) {
    lines.push("- none removed");
  } else {
    for (const item of removed) {
      lines.push(`- removed ${item.branch} -> ${item.path}`);
    }
  }

  if (failed.length > 0) {
    lines.push("");
    lines.push("Cleanup skipped for:");
    for (const item of failed) {
      lines.push(`- ${item.branch} -> ${item.path}: ${item.reason}`);
    }
  }

  return lines.join("\n");
}

export const WorktreeWorkflowPlugin = async ({ $, directory }) => {
  async function git(args, options = {}) {
    const cwd = options.cwd ?? directory;
    const command = `git ${args.map((arg) => $.escape(String(arg))).join(" ")}`;
    const result = await $`${{ raw: command }}`.cwd(cwd).quiet().nothrow();
    const stdout = result.text().trim();
    const stderr = result.stderr.toString("utf8").trim();

    if (!options.allowFailure && result.exitCode !== 0) {
      throw new Error(stderr || stdout || `Git command failed: ${command}`);
    }

    return {
      stdout,
      stderr,
      exitCode: result.exitCode,
    };
  }

  async function getRepoRoot() {
    const result = await git(["rev-parse", "--show-toplevel"]);
    return result.stdout;
  }

  async function loadWorkflowConfig(repoRoot) {
    const [projectConfig, projectConfigC, sidecarConfig] = await Promise.all([
      readJsonFile(path.join(repoRoot, "opencode.json")),
      readJsonFile(path.join(repoRoot, "opencode.jsonc")),
      readJsonFile(path.join(repoRoot, ".opencode", "worktree-workflow.json")),
    ]);

    const merged = {
      ...DEFAULTS,
      ...(projectConfig?.worktreeWorkflow ?? {}),
      ...(projectConfigC?.worktreeWorkflow ?? {}),
      ...(sidecarConfig ?? {}),
    };

    return {
      branchPrefix: normalizeBranchPrefix(merged.branchPrefix ?? DEFAULTS.branchPrefix),
      remote: merged.remote || DEFAULTS.remote,
      cleanupMode: merged.cleanupMode === "apply" ? "apply" : DEFAULTS.cleanupMode,
      protectedBranches: Array.isArray(merged.protectedBranches)
        ? merged.protectedBranches.filter((value) => typeof value === "string")
        : [],
      worktreeRoot: path.resolve(repoRoot, formatRootTemplate(merged.worktreeRoot || DEFAULTS.worktreeRoot, repoRoot)),
    };
  }

  async function getDefaultBranch(repoRoot, remote) {
    const remoteHead = await git(
      ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`],
      { cwd: repoRoot, allowFailure: true },
    );

    if (remoteHead.exitCode === 0 && remoteHead.stdout.startsWith(`${remote}/`)) {
      return remoteHead.stdout.slice(remote.length + 1);
    }

    const remoteShow = await git(["remote", "show", remote], {
      cwd: repoRoot,
      allowFailure: true,
    });

    if (remoteShow.exitCode === 0) {
      const match = remoteShow.stdout.match(/HEAD branch: (.+)/);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    for (const candidate of ["main", "master", "trunk", "develop"]) {
      const hasLocal = await git(["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], {
        cwd: repoRoot,
        allowFailure: true,
      });
      if (hasLocal.exitCode === 0) {
        return candidate;
      }

      const hasRemote = await git(["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${candidate}`], {
        cwd: repoRoot,
        allowFailure: true,
      });
      if (hasRemote.exitCode === 0) {
        return candidate;
      }
    }

    const currentBranch = await git(["branch", "--show-current"], {
      cwd: repoRoot,
      allowFailure: true,
    });

    if (currentBranch.stdout) {
      return currentBranch.stdout;
    }

    throw new Error("Could not determine the default branch for this repository.");
  }

  async function getBaseRef(repoRoot, remote, defaultBranch) {
    await git(["fetch", "--prune", remote, defaultBranch], { cwd: repoRoot });

    const remoteRef = `refs/remotes/${remote}/${defaultBranch}`;
    const remoteExists = await git(["show-ref", "--verify", "--quiet", remoteRef], {
      cwd: repoRoot,
      allowFailure: true,
    });

    return remoteExists.exitCode === 0 ? `${remote}/${defaultBranch}` : defaultBranch;
  }

  async function ensureBranchDoesNotExist(repoRoot, branchName) {
    const exists = await git(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
      cwd: repoRoot,
      allowFailure: true,
    });

    if (exists.exitCode === 0) {
      throw new Error(`Local branch already exists: ${branchName}`);
    }
  }

  return {
    tool: {
      worktree_prepare: tool({
        description: "Create a synced git worktree from a descriptive title",
        args: {
          title: tool.schema.string().min(3).describe("Descriptive working title for the new worktree"),
        },
        async execute(args, context) {
          context.metadata({ title: `Create worktree: ${args.title}` });

          const repoRoot = await getRepoRoot();
          const config = await loadWorkflowConfig(repoRoot);
          const defaultBranch = await getDefaultBranch(repoRoot, config.remote);
          const baseRef = await getBaseRef(repoRoot, config.remote, defaultBranch);
          const baseCommit = (await git(["rev-parse", baseRef], { cwd: repoRoot })).stdout;
          const slug = slugifyTitle(args.title);

          if (!slug) {
            throw new Error("Could not derive a branch name from the provided title.");
          }

          const branchName = `${config.branchPrefix}${slug}`;
          const worktreePath = path.join(config.worktreeRoot, slug);

          await ensureBranchDoesNotExist(repoRoot, branchName);

          if (await pathExists(worktreePath)) {
            throw new Error(`Worktree path already exists: ${worktreePath}`);
          }

          await fs.mkdir(config.worktreeRoot, { recursive: true });
          await git(["worktree", "add", "-b", branchName, worktreePath, baseRef], {
            cwd: repoRoot,
          });

          const branchCommit = (await git(["rev-parse", branchName], { cwd: repoRoot })).stdout;
          if (branchCommit !== baseCommit) {
            throw new Error(
              `New branch ${branchName} does not match ${defaultBranch} at ${baseCommit}. Found ${branchCommit} instead.`,
            );
          }

          return [
            `Created worktree for \"${args.title}\".`,
            `- branch: ${branchName}`,
            `- worktree: ${worktreePath}`,
            `- default branch: ${defaultBranch}`,
            `- base ref: ${baseRef}`,
            `- base commit: ${baseCommit}`,
          ].join("\n");
        },
      }),
      worktree_cleanup: tool({
        description: "Preview or clean merged git worktrees",
        args: {
          mode: tool.schema
            .enum(["preview", "apply"])
            .default("preview")
            .describe("Preview cleanup candidates or remove them"),
        },
        async execute(args, context) {
          context.metadata({ title: `Clean worktrees (${args.mode})` });

          const repoRoot = await getRepoRoot();
          const config = await loadWorkflowConfig(repoRoot);
          const defaultBranch = await getDefaultBranch(repoRoot, config.remote);
          const baseRef = await getBaseRef(repoRoot, config.remote, defaultBranch);
          const activeWorktree = path.resolve(context.worktree || repoRoot);
          const worktreeList = await git(["worktree", "list", "--porcelain"], { cwd: repoRoot });
          const entries = parseWorktreeList(worktreeList.stdout);
          const protectedBranches = new Set([defaultBranch, ...config.protectedBranches]);
          const candidates = [];

          for (const entry of entries) {
            const entryPath = path.resolve(entry.path);
            const branchName = entry.branch;

            if (!branchName || entry.detached) {
              continue;
            }

            if (entryPath === path.resolve(repoRoot) || entryPath === activeWorktree) {
              continue;
            }

            if (protectedBranches.has(branchName)) {
              continue;
            }

            const merged = await git(["merge-base", "--is-ancestor", branchName, baseRef], {
              cwd: repoRoot,
              allowFailure: true,
            });

            if (merged.exitCode === 0) {
              candidates.push({
                branch: branchName,
                path: entryPath,
                head: entry.head,
              });
            }
          }

          const requestedMode = args.mode || config.cleanupMode;
          if (requestedMode !== "apply") {
            return formatPreview(candidates, defaultBranch);
          }

          const removed = [];
          const failed = [];

          for (const candidate of candidates) {
            const removeWorktree = await git(["worktree", "remove", candidate.path], {
              cwd: repoRoot,
              allowFailure: true,
            });

            if (removeWorktree.exitCode !== 0) {
              failed.push({
                ...candidate,
                reason: removeWorktree.stderr || removeWorktree.stdout || "worktree remove failed",
              });
              continue;
            }

            const deleteBranch = await git(["branch", "-d", candidate.branch], {
              cwd: repoRoot,
              allowFailure: true,
            });

            if (deleteBranch.exitCode !== 0) {
              failed.push({
                ...candidate,
                reason: deleteBranch.stderr || deleteBranch.stdout || "branch delete failed",
              });
              continue;
            }

            removed.push(candidate);
          }

          await git(["worktree", "prune"], {
            cwd: repoRoot,
            allowFailure: true,
          });

          return formatCleanupSummary(defaultBranch, removed, failed);
        },
      }),
    },
  };
};

export default WorktreeWorkflowPlugin;
