import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "jsonc-parser";
import { inferTaskLifecycleTransition } from "./task-binding.js";

export const DEFAULTS = {
  branchPrefix: "wt/",
  remote: "origin",
  baseBranch: null,
  worktreeRoot: ".worktrees/$REPO",
  cleanupMode: "preview",
  protectedBranches: [],
};

export const RESULT_SCHEMA_VERSION = "1.0.0";

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function isMissingGitRepositoryError(message) {
  return /not a git repository/i.test(message);
}

export function isMissingRemoteError(message, remote) {
  return new RegExp(`No such remote:?\\s+${remote}|does not appear to be a git repository|Could not read from remote repository`, "i").test(message);
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
  return template.replaceAll("$REPO", repoName).replaceAll("$ROOT", repoRoot).replaceAll("$ROOT_PARENT", path.dirname(repoRoot));
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
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    if (line.startsWith("branch ")) {
      current.branchRef = line.slice("branch ".length);
      current.branch = parseShortBranch(current.branchRef);
    }
    if (line === "detached") current.detached = true;
  }
  if (current) entries.push(current);
  return entries;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function formatWorktreeSummary(item) {
  return `${item.branch || "(detached)"} -> ${item.path}${item.head ? ` (${item.head.slice(0, 12)})` : ""}`;
}

function formatCopyPasteCommands(item) {
  const selector = item.branch || item.path;
  const branchFlag = item.status === "safe" ? "-d" : "-D";

  return [
    `  copy: /wt-clean apply ${selector}`,
    `  git:  git worktree remove ${shellQuote(item.path)} && git branch ${branchFlag} ${shellQuote(item.branch)}`,
  ];
}

function formatPreviewSection(title, items, { includeCommands = false } = {}) {
  if (items.length === 0) return [title, "- none"];
  const lines = [title];
  for (const item of items) {
    lines.push(`- ${formatWorktreeSummary(item)}: ${item.reason}`);
    if (includeCommands && item.branch) lines.push(...formatCopyPasteCommands(item));
  }
  return lines;
}

function formatPreview(grouped, defaultBranch) {
  return [
    `Worktrees connected to this repository against ${defaultBranch}:`,
    "",
    ...formatPreviewSection("Safe to clean automatically:", grouped.safe, { includeCommands: true }),
    "",
    ...formatPreviewSection("Needs review before cleanup:", grouped.review, { includeCommands: true }),
    "",
    ...formatPreviewSection("Not cleanable here:", grouped.blocked),
    "",
    "Run `/wt-clean apply` to remove only the safe group.",
    "Run `/wt-clean apply <branch-or-path>` to also remove selected review items.",
  ].join("\n");
}

function formatPrepareSummary(result) {
  return [
    `Created worktree for "${result.title}".`,
    `- branch: ${result.branch}`,
    `- worktree: ${result.worktree_path}`,
    `- default branch: ${result.default_branch}`,
    `- base branch: ${result.base_branch}`,
    `- base ref: ${result.base_ref}`,
    `- base commit: ${result.base_commit}`,
  ].join("\n");
}

function formatCleanupSummary(defaultBranch, removed, failed, requestedSelectors) {
  const lines = [`Cleaned worktrees relative to ${defaultBranch}:`];
  if (removed.length === 0) lines.push("- none removed");
  for (const item of removed) lines.push(`- removed (${item.selected ? "selected" : "auto"}) ${item.branch} -> ${item.path}`);
  if (requestedSelectors.length > 0) {
    lines.push("", "Requested selectors:");
    for (const selector of requestedSelectors) lines.push(`- ${selector}`);
  }
  if (failed.length > 0) {
    lines.push("", "Cleanup skipped for:");
    for (const item of failed) lines.push(`- ${item.branch || item.selector} -> ${item.path || "(no path)"}: ${item.reason}`);
  }
  return lines.join("\n");
}

function toStructuredCleanupItem(item) {
  return {
    branch: item.branch ?? null,
    worktree_path: item.path ?? item.worktree_path ?? null,
    head: item.head ?? null,
    status: item.status ?? null,
    reason: item.reason ?? null,
    detached: Boolean(item.detached),
    selectable: typeof item.selectable === "boolean" ? item.selectable : null,
  };
}

function toStructuredCleanupFailure(item) {
  return {
    selector: item.selector ?? null,
    branch: item.branch ?? null,
    worktree_path: item.path ?? item.worktree_path ?? null,
    head: item.head ?? null,
    status: item.status ?? null,
    reason: item.reason ?? null,
    detached: Boolean(item.detached),
    selectable: typeof item.selectable === "boolean" ? item.selectable : null,
  };
}

function buildPrepareResult({ title, branch, worktreePath, defaultBranch, baseBranch, baseRef, baseCommit }) {
  const result = {
    schema_version: RESULT_SCHEMA_VERSION,
    ok: true,
    title,
    branch,
    worktree_path: worktreePath,
    default_branch: defaultBranch,
    base_branch: baseBranch,
    base_ref: baseRef,
    base_commit: baseCommit,
    created: true,
  };
  return { ...result, message: formatPrepareSummary(result) };
}

function buildCleanupPreviewResult({ defaultBranch, baseBranch, baseRef, grouped }) {
  const structuredGroups = {
    safe: grouped.safe.map(toStructuredCleanupItem),
    review: grouped.review.map(toStructuredCleanupItem),
    blocked: grouped.blocked.map(toStructuredCleanupItem),
  };
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    ok: true,
    mode: "preview",
    default_branch: defaultBranch,
    base_branch: baseBranch,
    base_ref: baseRef,
    groups: structuredGroups,
    message: formatPreview(grouped, baseBranch),
  };
}

function buildCleanupApplyResult({ defaultBranch, baseBranch, baseRef, removed, failed, requestedSelectors }) {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    ok: true,
    mode: "apply",
    default_branch: defaultBranch,
    base_branch: baseBranch,
    base_ref: baseRef,
    requested_selectors: requestedSelectors,
    removed: removed.map((item) => ({ ...toStructuredCleanupItem(item), selected: Boolean(item.selected) })),
    failed: failed.map(toStructuredCleanupFailure),
    message: formatCleanupSummary(baseBranch, removed, failed, requestedSelectors),
  };
}

function splitCleanupToken(value) {
  if (typeof value !== "string") return [];
  return value.trim().split(/\s+/).filter(Boolean);
}

function parseCleanupRawArguments(raw) {
  const tokens = splitCleanupToken(raw);
  if (tokens[0] === "apply") return { mode: "apply", selectors: tokens.slice(1) };
  if (tokens[0] === "preview") return { mode: "preview", selectors: tokens.slice(1) };
  return { mode: null, selectors: tokens };
}

function normalizeCleanupArgs(args, config) {
  const selectors = Array.isArray(args.selectors) ? [...args.selectors] : [];
  const normalizedSelectors = [];
  const rawArgs = parseCleanupRawArguments(args.raw);
  let explicitMode = rawArgs.mode;
  if (rawArgs.selectors.length > 0) selectors.unshift(...rawArgs.selectors);
  if (typeof args.mode === "string" && args.mode.trim()) {
    const modeValue = args.mode.trim();
    if (modeValue === "apply" || modeValue === "preview") explicitMode = modeValue;
    else selectors.unshift(...splitCleanupToken(modeValue));
  }
  for (const selector of selectors) {
    if (typeof selector !== "string") continue;
    if (selector.includes(" ")) normalizedSelectors.push(...splitCleanupToken(selector));
    else normalizedSelectors.push(selector);
  }
  const inlineApply = normalizedSelectors[0] === "apply";
  if (inlineApply) normalizedSelectors.shift();
  const mode = explicitMode === "apply" || inlineApply ? "apply" : explicitMode || config.cleanupMode;
  return { mode, selectors: normalizedSelectors };
}

function selectorMatches(item, selector) {
  return item.branch === selector || item.path === path.resolve(selector);
}

function classifyEntry(entry, repoRoot, activeWorktree, protectedBranches, mergedIntoBase) {
  const entryPath = path.resolve(entry.path);
  const branchName = entry.branch;
  const item = { branch: branchName, path: entryPath, head: entry.head, detached: Boolean(entry.detached) };
  if (!branchName || entry.detached) return { ...item, status: "blocked", reason: !branchName ? "no branch" : "detached HEAD", selectable: false };
  if (entryPath === path.resolve(repoRoot)) {
    return {
      ...item,
      status: "blocked",
      reason: entryPath === activeWorktree ? "repository root, current worktree, protected branch" : "repository root",
      selectable: false,
    };
  }
  if (entryPath === activeWorktree) return { ...item, status: "blocked", reason: "current worktree", selectable: false };
  if (protectedBranches.has(branchName)) return { ...item, status: "blocked", reason: "protected branch", selectable: false };
  if (mergedIntoBase) return { ...item, status: "safe", reason: "merged into base branch by git ancestry", selectable: true };
  return { ...item, status: "review", reason: "not merged into base branch by git ancestry", selectable: true };
}

export function createWorktreeWorkflowService({ directory, git, stateStore }) {
  async function getRepoRoot() {
    try {
      return (await git(["rev-parse", "--show-toplevel"], { cwd: directory })).stdout;
    } catch (error) {
      if (isMissingGitRepositoryError(error.message || "")) {
        throw new Error("This command must run inside a git repository. Initialize a repository first or run it from an existing repo root.");
      }
      throw error;
    }
  }
  async function loadWorkflowConfig(repoRoot) {
    const [projectConfig, projectConfigC, sidecarConfig] = await Promise.all([
      readJsonFile(path.join(repoRoot, "opencode.json")),
      readJsonFile(path.join(repoRoot, "opencode.jsonc")),
      readJsonFile(path.join(repoRoot, ".opencode", "worktree-workflow.json")),
    ]);
    const merged = { ...DEFAULTS, ...(projectConfig?.worktreeWorkflow ?? {}), ...(projectConfigC?.worktreeWorkflow ?? {}), ...(sidecarConfig ?? {}) };
    return {
      branchPrefix: normalizeBranchPrefix(merged.branchPrefix ?? DEFAULTS.branchPrefix),
      remote: merged.remote || DEFAULTS.remote,
      baseBranch: typeof merged.baseBranch === "string" && merged.baseBranch.trim() ? merged.baseBranch.trim() : null,
      cleanupMode: merged.cleanupMode === "apply" ? "apply" : DEFAULTS.cleanupMode,
      protectedBranches: Array.isArray(merged.protectedBranches) ? merged.protectedBranches.filter((value) => typeof value === "string") : [],
      worktreeRoot: path.resolve(repoRoot, formatRootTemplate(merged.worktreeRoot || DEFAULTS.worktreeRoot, repoRoot)),
    };
  }
  async function getDefaultBranch(repoRoot, remote) {
    const remoteHead = await git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], { cwd: repoRoot, allowFailure: true });
    if (remoteHead.exitCode === 0 && remoteHead.stdout.startsWith(`${remote}/`)) return remoteHead.stdout.slice(remote.length + 1);
    const remoteShow = await git(["remote", "show", remote], { cwd: repoRoot, allowFailure: true });
    if (remoteShow.exitCode === 0) {
      const match = remoteShow.stdout.match(/HEAD branch: (.+)/);
      if (match?.[1]) return match[1].trim();
    }
    for (const candidate of ["main", "master", "trunk", "develop"]) {
      if ((await git(["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], { cwd: repoRoot, allowFailure: true })).exitCode === 0) return candidate;
      if ((await git(["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${candidate}`], { cwd: repoRoot, allowFailure: true })).exitCode === 0) return candidate;
    }
    const currentBranch = await git(["branch", "--show-current"], { cwd: repoRoot, allowFailure: true });
    if (currentBranch.stdout) return currentBranch.stdout;
    throw new Error("Could not determine the default branch for this repository.");
  }
  async function resolveBaseTarget(repoRoot, config) {
    const defaultBranch = await getDefaultBranch(repoRoot, config.remote);
    const baseBranch = config.baseBranch || defaultBranch;
    try {
      await git(["fetch", "--prune", config.remote, baseBranch], { cwd: repoRoot });
    } catch (error) {
      if (isMissingRemoteError(error.message || "", config.remote)) {
        throw new Error(`Could not fetch base branch information from remote \"${config.remote}\". Configure the expected remote in .opencode/worktree-workflow.json or add that remote to this repository.`);
      }
      throw error;
    }
    const remoteRef = `refs/remotes/${config.remote}/${baseBranch}`;
    const remoteExists = await git(["show-ref", "--verify", "--quiet", remoteRef], { cwd: repoRoot, allowFailure: true });
    const baseRef = remoteExists.exitCode === 0 ? `${config.remote}/${baseBranch}` : baseBranch;
    return { defaultBranch, baseBranch, baseRef };
  }
  async function ensureBranchDoesNotExist(repoRoot, branchName) {
    const exists = await git(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], { cwd: repoRoot, allowFailure: true });
    if (exists.exitCode === 0) throw new Error(`Local branch already exists: ${branchName}`);
  }
  async function updateStateForPrepare(repoRoot, sessionID, prepared, createdBy = "manual") {
    if (!sessionID || !stateStore) return;
    const state = await stateStore.loadSessionState(repoRoot, sessionID);
    const next = stateStore.setActiveTask(
      stateStore.upsertTask(state, {
        task_id: prepared.branch,
        title: prepared.title,
        branch: prepared.branch,
        worktree_path: prepared.worktree_path,
        created_by: createdBy,
        status: inferTaskLifecycleTransition({ explicitSignal: "activate" }),
      }),
      prepared.branch,
    );
    await stateStore.saveSessionState(repoRoot, sessionID, next);
  }
  async function updateStateForCleanup(repoRoot, sessionID, removed) {
    if (!sessionID || !stateStore || removed.length === 0) return;
    let state = await stateStore.loadSessionState(repoRoot, sessionID);
    for (const item of removed) {
      state = stateStore.upsertTask(state, {
        task_id: item.branch,
        branch: item.branch,
        worktree_path: item.path,
        status: inferTaskLifecycleTransition({ explicitSignal: "complete" }),
      });
      if (stateStore.getActiveTask(state) === item.branch) {
        state = stateStore.setActiveTask(state, null);
      }
    }
    await stateStore.saveSessionState(repoRoot, sessionID, state);
  }

  async function prepare({ title, sessionID, createdBy = "manual" }) {
    const repoRoot = await getRepoRoot();
    const config = await loadWorkflowConfig(repoRoot);
    const { defaultBranch, baseBranch, baseRef } = await resolveBaseTarget(repoRoot, config);
    const baseCommit = (await git(["rev-parse", baseRef], { cwd: repoRoot })).stdout;
    const slug = slugifyTitle(title);
    if (!slug) throw new Error("Could not derive a branch name from the provided title.");
    const branchName = `${config.branchPrefix}${slug}`;
    const worktreePath = path.join(config.worktreeRoot, slug);
    await ensureBranchDoesNotExist(repoRoot, branchName);
    if (await pathExists(worktreePath)) throw new Error(`Worktree path already exists: ${worktreePath}`);
    await fs.mkdir(config.worktreeRoot, { recursive: true });
    await git(["worktree", "add", "-b", branchName, worktreePath, baseRef], { cwd: repoRoot });
    const branchCommit = (await git(["rev-parse", branchName], { cwd: repoRoot })).stdout;
    if (branchCommit !== baseCommit) throw new Error(`New branch ${branchName} does not match ${baseBranch} at ${baseCommit}. Found ${branchCommit} instead.`);
    const result = buildPrepareResult({ title, branch: branchName, worktreePath, defaultBranch, baseBranch, baseRef, baseCommit });
    await updateStateForPrepare(repoRoot, sessionID, result, createdBy);
    return result;
  }

  async function getSessionBinding({ repoRoot, sessionID }) {
    if (!stateStore || !sessionID) return { state: null, activeTask: null };
    const state = await stateStore.loadSessionState(repoRoot, sessionID);
    const activeTask = stateStore.getActiveTaskRecord(state);
    return { state, activeTask };
  }

  async function ensureActiveWorktree({ sessionID, title }) {
    const repoRoot = await getRepoRoot();
    const { activeTask } = await getSessionBinding({ repoRoot, sessionID });
    if (activeTask?.worktree_path) {
      return { repoRoot, task: activeTask };
    }
    const prepared = await prepare({ title, sessionID, createdBy: "harness" });
    return {
      repoRoot,
      task: {
        task_id: prepared.branch,
        title: prepared.title,
        branch: prepared.branch,
        worktree_path: prepared.worktree_path,
        created_by: "harness",
        status: "active",
      },
    };
  }

  async function recordToolUsage({ sessionID }) {
    if (!stateStore || !sessionID) return;
    const repoRoot = await getRepoRoot();
    const state = await stateStore.loadSessionState(repoRoot, sessionID);
    const activeTaskID = stateStore.getActiveTask(state);
    if (!activeTaskID) return;
    const next = stateStore.touchTask(state, activeTaskID);
    await stateStore.saveSessionState(repoRoot, sessionID, next);
  }

  async function cleanup({ mode, raw, selectors = [], worktree, sessionID }) {
    const repoRoot = await getRepoRoot();
    const config = await loadWorkflowConfig(repoRoot);
    const normalizedArgs = normalizeCleanupArgs({ mode, raw, selectors }, config);
    const { defaultBranch, baseBranch, baseRef } = await resolveBaseTarget(repoRoot, config);
    const activeWorktree = path.resolve(worktree || repoRoot);
    const entries = parseWorktreeList((await git(["worktree", "list", "--porcelain"], { cwd: repoRoot })).stdout);
    const protectedBranches = new Set([defaultBranch, baseBranch, ...config.protectedBranches]);
    const grouped = { safe: [], review: [], blocked: [] };
    for (const entry of entries) {
      let mergedIntoBase = false;
      if (entry.branch && !entry.detached) {
        const merged = await git(["merge-base", "--is-ancestor", entry.branch, baseRef], { cwd: repoRoot, allowFailure: true });
        mergedIntoBase = merged.exitCode === 0;
      }
      const classified = classifyEntry(entry, repoRoot, activeWorktree, protectedBranches, mergedIntoBase);
      grouped[classified.status].push(classified);
    }
    if (normalizedArgs.mode !== "apply") return buildCleanupPreviewResult({ defaultBranch, baseBranch, baseRef, grouped });
    const requestedSelectors = [...new Set(normalizedArgs.selectors || [])];
    const selected = [];
    const failed = [];
    for (const selector of requestedSelectors) {
      const match = [...grouped.safe, ...grouped.review, ...grouped.blocked].find((item) => selectorMatches(item, selector));
      if (!match) {
        failed.push({ selector, reason: "selector did not match any connected worktree" });
        continue;
      }
      if (!match.selectable) {
        failed.push({ ...match, selector, reason: `cannot remove via selector: ${match.reason}` });
        continue;
      }
      selected.push({ ...match, selector });
    }
    const targets = [...grouped.safe];
    for (const item of selected) {
      if (!targets.some((target) => target.path === item.path)) targets.push({ ...item, selector: item.selector ?? null, selected: true });
    }
    const removed = [];
    for (const candidate of targets) {
      const removeWorktree = await git(["worktree", "remove", candidate.path], { cwd: repoRoot, allowFailure: true });
      if (removeWorktree.exitCode !== 0) {
        failed.push({ ...candidate, reason: removeWorktree.stderr || removeWorktree.stdout || "worktree remove failed" });
        continue;
      }
      const deleteBranch = await git(["branch", candidate.status === "safe" ? "-d" : "-D", candidate.branch], { cwd: repoRoot, allowFailure: true });
      if (deleteBranch.exitCode !== 0) {
        failed.push({ ...candidate, reason: deleteBranch.stderr || deleteBranch.stdout || "branch delete failed" });
        continue;
      }
      removed.push(candidate);
    }
    await git(["worktree", "prune"], { cwd: repoRoot, allowFailure: true });
    const result = buildCleanupApplyResult({ defaultBranch, baseBranch, baseRef, removed, failed, requestedSelectors });
    await updateStateForCleanup(repoRoot, sessionID, removed);
    return result;
  }

  return { prepare, cleanup, getRepoRoot, getSessionBinding, ensureActiveWorktree, recordToolUsage, updateStateForPrepare };
}

export const __internalService = {
  RESULT_SCHEMA_VERSION,
  buildCleanupApplyResult,
  buildCleanupPreviewResult,
  buildPrepareResult,
  classifyEntry,
  normalizeCleanupArgs,
  parseCleanupRawArguments,
  toStructuredCleanupFailure,
  toStructuredCleanupItem,
};
