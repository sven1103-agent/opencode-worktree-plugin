# Worktree Workflow Implementation Plan

## Purpose

This document captures the agreed implementation plan for evolving the worktree workflow into a package with a stable machine contract, a CLI fallback path, thin human-facing slash commands, and orchestration-friendly task workspace handling.

## Goals

- Keep the package as the canonical capability layer.
- Support both native plugin execution and `bunx` CLI fallback.
- Keep slash commands as first-class human UX, but make them thin wrappers.
- Co-ship the skill with the worktree workflow package for now because they form a strong functional unit.
- Keep orchestration details in the primary agent/runtime layer even if the skill is shipped from the same repo.
- Enable task-scoped shared worktrees for orchestrated planning, execution, and review.
- Preserve a serious plugin-side enforcement path for mutating work even if OpenCode does not guarantee general built-in multi-worktree routing.

## Runtime Constraint Update

Validation against current OpenCode runtime behavior showed that hook payload replacement is not a safe assumption for built-in tools. In practice, plugin logic must mutate live payload objects in place, and hard execution-location guarantees should be reserved for tool paths the plugin owns directly.

This changes the implementation shape:

- hooks remain useful for classification, state, handoff context, and safe in-place argument mutation
- transparent routing of every built-in tool should not be treated as a guaranteed platform capability
- plugin-owned mutating tools are the preferred path where hard worktree routing guarantees are required

## Phase 1: Package Contract Hardening

### Scope

- Define a versioned structured result contract for `worktree_prepare`.
- Define a versioned structured result contract for `worktree_cleanup` in both `preview` and `apply` modes.
- Refactor internal package design so logic returns objects first and human text is rendered second.
- Move argument normalization fully into package internals.

### Acceptance Criteria

- Native plugin calls can return structured data without parsing prose.
- `worktree_prepare` always returns:
  - `ok`
  - `title`
  - `branch`
  - `worktree_path`
  - `default_branch`
  - `base_branch`
  - `base_ref`
  - `base_commit`
  - `created`
- `worktree_cleanup` preview always returns grouped structured items for `safe`, `review`, and `blocked`.
- `worktree_cleanup` apply always returns `requested_selectors`, `removed`, and `failed`.
- Partial cleanup is represented as a successful reconciliation result, not a top-level failure.
- Existing human-readable output can still be produced from the structured result.

## Phase 2: CLI Fallback Surface

### Scope

- Add a CLI entrypoint to the same npm package.
- Expose commands like:
  - `wt-new <title>`
  - `wt-clean [preview|apply] [selectors...]`
- Add `--json` output for orchestration and scripting.
- Ensure CLI and native plugin use the same underlying implementation.

### Acceptance Criteria

- The package can be run via `bunx` without repo-local helper scripts.
- `wt-new --json` returns the same core fields as native `worktree_prepare`.
- `wt-clean --json` returns the same core fields as native `worktree_cleanup`.
- CLI argument handling does not require duplicated logic in skills or slash commands.
- CLI human output remains readable for manual use.

## Phase 3: Slash Command Simplification

### Scope

- Reduce `/wt-new` to a minimal wrapper around the canonical package capability.
- Reduce `/wt-clean` to a minimal wrapper around the canonical package capability.
- Remove duplicated invocation semantics from command files where package logic can own them.

### Acceptance Criteria

- Slash commands remain usable for human-triggered workflows.
- Slash commands no longer carry unique business logic that must stay in sync with the package.
- Behavior of slash commands matches the native tool/CLI contract.
- Human users can still run preview/apply cleanup ergonomically.

## Phase 4: Compatibility Contract

### Scope

- Publish a short compatibility contract document.
- Define the package-internal compatibility contract between native plugin, CLI, slash commands, and the co-shipped skill.
- Document stable required fields for native and CLI paths.

### Acceptance Criteria

- The skill can target a documented contract rather than package internals.
- Native plugin, CLI, slash commands, and the co-shipped skill share one documented contract.
- The repo can still split the skill into a separate distribution later without changing the core contract.
- A new team can understand how native plugin, CLI fallback, and slash commands relate.

## Phase 5: Org Skill Design

### Scope

- Draft a `worktree-workflow` skill covering:
  - root is shared and only for tiny/root-safe tasks
  - task-scoped worktrees are the default for non-trivial editable work
  - one task worktree is shared across planning, execution, and review unless work diverges
  - divergent worktrees are only for conflicting or independent concurrent branches
  - cleanup is preview-first
  - capability ladder: native tool -> `bunx` CLI -> tiny/root-safe fallback only
- Explicitly define `tiny/root-safe`.
- Keep the skill abstract about runtime storage and session artifacts.
- Ship the skill from this repository for the initial release.

### Acceptance Criteria

- The skill does not mention `.opencode/sessions/...` or concrete storage mechanics.
- The skill defines when to isolate work, not how orchestration persists it.
- The skill supports both native-plugin and `bunx` fallback environments.
- The skill does not duplicate package argument normalization logic.
- The skill can later move to a separate repo without changing its behavioral contract.

## Phase 6: Coding Boss Orchestration Contract

### Scope

- Extend `coding-boss` so it:
  - selects root vs task worktree before delegation
  - creates or selects one task-scoped worktree for non-trivial editable work
  - shares that same worktree across planner, implementer, and reviewer for one task
  - creates divergent worktrees only when work truly branches
  - centralizes cleanup apply authority
- Define explicit workspace context passed in editable handoffs:
  - `task_title`
  - `worktree_path`
  - `workspace_role`
  - `lifecycle_state`

### Acceptance Criteria

- Editable delegated tasks always carry explicit workspace context.
- Subagents do not choose their own workspace.
- Linear flows reuse the same task worktree.
- Divergent worktrees are created only by the orchestrator.
- Cleanup apply is orchestrator-only.

## Phase 6.5: Plugin-Owned Mutating Tool Surface

### Scope

- Add plugin-owned mutating tools where hard worktree routing guarantees are required.
- Start with the narrowest serious set:
  - `write`
  - `edit`
  - `apply_patch`
  - optionally `bash` for mutating shell execution
- Keep read-only tools host-owned unless there is a clear need for parity.
- Route these plugin-owned tools through the active task binding and shared core service.

### Acceptance Criteria

- Mutating operations that must be isolated execute against the bound task worktree without depending on undocumented built-in hook replacement behavior.
- The plugin can block unsafe repo-root mutation even when host-owned built-in routing is ambiguous.
- The architecture clearly distinguishes advisory steering of host-owned tools from hard routing of plugin-owned mutating tools.

## Phase 7: Session-State Runtime Metadata

### Scope

- Extend session artifacts to track task and workspace metadata.
- Add lifecycle tracking for:
  - `planned`
  - `active`
  - `review`
  - `done`
- Register, update, and unregister task worktrees in session state.
- Include minimal audit and intent fields:
  - `task_title`
  - `worktree_path`
  - `workspace_role`
  - `lifecycle_state`
  - `created_by`
  - `created_at`
  - optional `parent_task_id`
  - optional `user_intent`

### Acceptance Criteria

- Active task worktrees can be identified from session or runtime state.
- Follow-on handoffs can resume the same workspace reliably.
- Divergent worktrees can be traced back to parent task lineage.
- Cleanup logic can check runtime state before removal.
- No repo-committed files are required for orchestration metadata.

## Phase 8: Cleanup Governance

### Scope

- Keep plugin cleanup classification based on git and worktree facts only.
- Add orchestrator-side protections for active or retained worktrees.
- Auto-run cleanup preview when a task reaches `done`.
- Never auto-apply cleanup.
- Show a retained-worktree notice when cleanup is not applied.
- Fail closed for apply if runtime state is missing or inconsistent, and downgrade uncertain items to review.

### Acceptance Criteria

- A merged branch is not enough by itself for auto-clean in orchestrated flows.
- Active or retained task worktrees are never auto-removed.
- Cleanup preview can still run even when runtime state is incomplete.
- Cleanup apply only proceeds when both git facts and runtime state allow it.
- Users are informed when a finished task leaves behind a retained worktree.

## Phase 9: Testing Strategy

### Scope

- Add plugin tests for:
  - structured schemas
  - classification logic
  - cleanup partial-success behavior
- Add CLI tests for:
  - argument parsing
  - parity with native plugin schema
- Add slash command tests for thin wrapper behavior only.
- Add skill tests for:
  - root vs worktree policy
  - native tool vs `bunx` fallback selection
  - stop behavior when isolation is unavailable
- Add integration tests for:
  - skill -> native plugin path
  - skill -> `bunx` fallback path
  - plugin-owned mutating tool path

### Acceptance Criteria

- Every layer has a clearly owned contract test surface.
- Native plugin and CLI produce compatible structured outputs.
- Skill decisions can be validated independently of package internals.
- At least one happy path exists for both native and fallback execution modes.
- At least one happy path proves hard-routed mutation through a plugin-owned tool.

## Recommended Work Split

- Track A: package contract and CLI
- Track B: slash commands, compatibility docs, and co-shipped skill packaging
- Track C: skill drafting
- Track D: `coding-boss` orchestration and session metadata
- Track E: cleanup governance and tests

## Suggested Milestone Order

1. Package structured contract
2. CLI fallback
3. Slash command thinning
4. Compatibility doc
5. Skill draft and co-shipping setup
6. `coding-boss` orchestration changes
7. Plugin-owned mutating tools
8. Session metadata and lifecycle
9. Cleanup governance
10. Integration tests

## Definition of Done

- A non-trivial coding task can be routed by `coding-boss` into a task-scoped worktree.
- Planner, implementer, and reviewer can share the same explicit `worktree_path`.
- The same task can run with either native plugin or `bunx` fallback.
- Hard-isolated mutating execution does not depend on undocumented built-in tool redirection behavior.
- Cleanup preview works with structured output.
- Cleanup apply is orchestrator-controlled and protected by runtime task state.
- Skill, package, CLI, and slash commands each have a clean, non-duplicated responsibility boundary even when shipped from the same repo.
