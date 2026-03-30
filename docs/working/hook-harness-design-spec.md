# Hook Harness Design Spec

## Purpose

This document defines a deterministic worktree harness for OpenCode using plugin event hooks. The goal is to move workspace isolation behavior out of prompt-only skills and into an execution-layer control plane that can enforce worktree creation, binding, reuse, and advisory cleanup consistently.

## Problem Statement

The current worktree workflow relies on skills and orchestrator prompts to convince agents to call `worktree_prepare` and `worktree_cleanup` at the right time. That behavior is not reliable enough because skills are still prompt text, and agents can skip or misapply them. The result is nondeterministic workspace selection and inconsistent cleanup behavior.

## Goals

- Make worktree creation deterministic for non-trivial editable work.
- Keep cleanup advisory-only.
- Preserve one shared worktree across one linear task flow unless the orchestrator explicitly forks the work.
- Keep the primary orchestrator as the only authority that can create, switch, fork, or cleanup-manage worktrees.
- Keep the skill policy-oriented and move enforcement into plugin hooks.
- Keep the existing `worktree_prepare` and `worktree_cleanup` tool contract as the public capability surface.

## Non-Goals

- Replacing the current `worktree_prepare` or `worktree_cleanup` contract.
- Moving lifecycle policy into the co-shipped skill.
- Letting subagents select, create, or clean up worktrees.
- Auto-applying cleanup.

## Primary Invariants

- No non-trivial editable work starts in repo root.
- All linear delegated work reuses the same bound worktree unless explicitly forked.
- Only the primary orchestrator may create, switch, fork, or cleanup-manage worktrees.
- Cleanup is preview-first and advisory-only.
- If isolation is required and cannot be provisioned or enforced safely, execution blocks unless the user explicitly overrides the policy.

## Architectural Overview

The harness has four layers:

1. Core worktree service
2. Public tool and command surfaces
3. Hook-based harness enforcement
4. Plugin-managed runtime state

### Core Worktree Service

Shared internal services should own:

- worktree preparation
- cleanup preview and cleanup apply orchestration hooks
- task binding lifecycle
- path and workdir rewriting
- runtime state loading and persistence
- task continuity resolution helpers

This core layer should be called both by public tools and by hooks. Hooks must not recursively invoke public tools because that creates re-entrancy and hook-loop risk.

### Public Surfaces

The public capability surface remains:

- `worktree_prepare`
- `worktree_cleanup`
- `/wt-new`
- `/wt-clean`

Manual calls should still work, but they should be adopted into the same managed task-binding system.

### Hook Harness Layer

Recommended OpenCode hooks:

- `tool.execute.before`: primary enforcement point
- `tool.execute.after`: state updates and advisory signaling
- `command.execute.before`: slash-command normalization and parity
- `experimental.chat.system.transform`: model-facing context injection only

### Runtime State Layer

The authoritative runtime state should live outside the repo in plugin-managed storage keyed by canonical repo root and `sessionID`. Optional diagnostic mirrors inside `.opencode/` are acceptable, but they must not be authoritative.

## Binding Model

### Binding Scope

Worktree bindings are scoped to a logical task or workstream within a session.

- a session may contain multiple task records over time
- exactly one task is active at a time
- planner, implementer, and reviewer share the same binding for one linear task
- role changes do not create workspace boundaries
- task switches do not imply completion

### Task Lifecycle States

Keep the state model minimal:

- `active`
- `inactive`
- `completed`
- `blocked`

Auto-completion is allowed only from strong orchestrator-level finalization signals, not from low-level tool events like test success or commit success.

### Proposed Runtime State Shape

```json
{
  "session_id": "string",
  "repo_root": "string",
  "active_task_id": "string|null",
  "tasks": [
    {
      "task_id": "string",
      "title": "string",
      "worktree_path": "string",
      "branch": "string|null",
      "status": "active|inactive|completed|blocked",
      "created_by": "harness|manual",
      "workspace_role": "linear-flow|planner|implementer|reviewer|null",
      "scope_hints": ["string"],
      "created_at": "ISO-8601",
      "last_used_at": "ISO-8601"
    }
  ]
}
```

## Classification Policy

The harness should classify runtime behavior conservatively.

### Isolation Required

Create or select a task worktree when any of these are true:

- the tool call is mutating
- the tool call is a Task-tool delegation for non-trivial work
- the request likely requires an edit-test-fix loop
- the scope touches multiple files or an unknown set of files
- the request is implementation, refactoring, debugging, migration, or non-trivial planning

### Repo Root Allowed

Repo root is allowed only for tiny root-safe work:

- read-only work, or one tiny edit to one or two closely related files
- no delegation
- no likely iteration loop
- low interference risk with dirty root state

If the harness cannot confidently classify the work as root-safe, it should require isolation.

## Mutating Tool Policy

Mutation should be defined semantically rather than by a brittle tool-name list.

### Mutating

- file create, edit, patch, delete, rename
- shell commands that change repo state
- installs, code generation, formatter or fixer runs
- tests that update snapshots or write repo files
- delegations likely to produce edits

### Non-Mutating

- read, glob, grep, web fetch
- read-only git commands
- planning-only delegation

If the harness cannot prove that a tool call is read-only, it should treat it as mutating.

## Hook Contracts

### `tool.execute.before`

This is the main enforcement point.

Responsibilities:

- inspect tool identity and arguments
- classify the call as read-only, mutating, or delegation
- resolve task continuity
- create or select a bound worktree if isolation is required
- rewrite execution context and repo-scoped paths into the bound worktree
- block when safe provisioning or safe rewriting is not possible

This hook is the main choke point because it runs immediately before the action happens.

### `tool.execute.after`

Responsibilities:

- update `last_used_at`
- adopt manual `worktree_prepare` results into runtime state
- observe manual `worktree_cleanup` and update managed state
- record task completion or blocked signals when they are explicit or strongly inferred
- trigger cleanup advice at defined advisory moments

### `command.execute.before`

Responsibilities:

- route `/wt-new` and `/wt-clean` through the same state model
- keep slash commands as human UX only, not a separate control plane

### `experimental.chat.system.transform`

Responsibilities:

- inject active `task_id` and task title
- inject active `worktree_path`
- inject a concise workspace policy reminder

This hook improves model behavior but is not part of enforcement.

## Delegation Policy

Task-tool calls are the canonical delegation boundary.

Before editable delegation, the harness should:

- resolve whether the request continues the active task or starts a new one
- create or select the worktree before the delegation happens
- bind the task as active
- include explicit workspace context in the handoff

Subagents must not create, switch, fork, or clean up worktrees. They should operate only inside the workspace handed to them by the primary orchestrator.

## Task Continuity Policy

### Reuse Existing Task

Reuse the current active task when all are true:

- the request clearly continues the same objective
- file or subsystem overlap is strong
- there is no competing objective
- the user is not asking for a distinct alternative or experiment

### Create New Task

Create a new task and switch it active when any are true:

- the request clearly starts a distinct objective
- the request changes subsystem or workstream materially
- the user asks for an alternative approach or experiment branch
- concurrent delegated work would likely conflict

### Ask the User on Ambiguity

When reuse versus new task is genuinely ambiguous, ask the user. If the ambiguity remains meaningful and the work is non-trivial, default to a new worktree.

## Worktree Creation Policy

### Creation Timing

Create or select the worktree:

- before the first mutating tool call
- before the first risky delegation

The harness should not wait for a subagent to encounter its first mutating action.

### Creation Mechanism

Hooks should call the shared internal preparation service rather than recursively invoking `worktree_prepare`.

### Title and Naming

Use this priority order for auto-created task titles:

1. explicit orchestrator task title
2. concise summary of the current user request
3. `task-<shortid>` fallback

The existing prepare logic should continue to own slugification and branch naming.

### Provenance

Every created or adopted worktree record should carry provenance:

- `created_by: harness`
- `created_by: manual`

Provenance should affect messaging and cleanup recommendations, but not whether the worktree participates in the managed state model.

## Path and Workdir Rewriting

The harness should rewrite execution into the bound worktree by default.

### Rewrite Rules

- always rewrite repo-scoped workdir or cwd into the active worktree
- always rewrite repo-scoped file paths into the active worktree
- never rewrite clearly external absolute paths
- block rather than guess when a path cannot be safely classified

This should make workspace isolation deterministic without depending on agents to remember worktree-local paths.

## Privilege Model

### Primary Orchestrator

The primary orchestrator may:

- create worktrees
- select and switch active task bindings
- fork divergent worktrees
- resolve ambiguity with the user
- surface cleanup advice
- request a narrow override when policy would otherwise block execution

### Subagents

Subagents may:

- operate inside the bound worktree they receive
- report results and status

Subagents may not:

- create worktrees
- switch active bindings
- fork worktrees
- perform cleanup management

## Manual Tool Parity

### Manual `worktree_prepare`

Manual prepare calls should:

- create a managed task binding
- update runtime state
- optionally become the active task binding
- be marked `created_by: manual`

### Manual `worktree_cleanup`

Manual cleanup calls should:

- pass through the same harness policy layer first
- update runtime state after preview or apply
- remain explicit and user-driven for destructive apply

## Cleanup Policy

Cleanup remains advisory-only.

### Advisory Moments

Surface cleanup advice only at these points:

- when a Task-tool delegation is explicitly or strongly inferred complete from result artifacts linked to the delegated handoff
- when the user explicitly asks about worktrees or cleanup
- at session end or long-inactivity resume

Do not emit cleanup advice on blocked outcomes or on unrelated tool completions.

### Cleanup Visibility

The harness should inspect all connected worktrees in the repo, but distinguish:

- harness-managed
- manual or external
- unknown provenance

Recommendations may be stronger for harness-managed worktrees, but the harness must not imply ownership of manually created worktrees.

## Failure and Override Policy

### Fail Closed

If isolation is required and any of the following occur, the harness should block:

- worktree preparation fails
- task binding cannot be established
- path or workdir rewriting cannot be done safely

The harness must not silently fall back to repo root.

### Narrow Override

Allow a narrow escape hatch only when the user explicitly authorizes it.

Override rules:

- explicit
- per-task or per-request
- visible in status or output
- never automatic

The same override policy should cover both worktree provisioning failures and unsafe rewrite cases.

## Handoff Contract Changes

Editable delegation handoffs should carry explicit workspace fields in the canonical handoff schema, not only in plugin sidecar state.

Optional-first fields (backward compatible):

- `task_id`
- `task_title`
- `worktree_path`
- `workspace_role`
- `lifecycle_state`

Recommended schema shape:

```json
{
  "task_id": "string",
  "task_title": "string",
  "worktree_path": "string",
  "workspace_role": "planner|implementer|reviewer|linear-flow",
  "lifecycle_state": "active|inactive|completed|blocked"
}
```

This makes workspace context portable and inspectable across fresh-context subagents.

## Acceptance Criteria

- A mutating tool call in a non-trivial task does not execute in repo root when no bound worktree exists.
- A Task-tool editable delegation causes worktree binding before delegation.
- Planner, implementer, and reviewer reuse the same worktree for one linear task unless the orchestrator explicitly forks.
- Manual `worktree_prepare` is adopted into managed runtime state.
- Manual `worktree_cleanup` passes through the same harness policy layer.
- Cleanup advice appears only at defined advisory moments.
- Provisioning or rewrite failures block execution unless the user explicitly overrides.
- Model prompt injection improves context but is not required for enforcement correctness.

## Test Matrix

- root-safe read-only request stays in repo root
- first mutating tool call auto-creates and binds a worktree
- first editable delegation auto-creates before the Task-tool call
- continuation request reuses the active task worktree
- clearly new task creates a new binding and switches active task
- ambiguous continuation asks the user
- manual `worktree_prepare` updates runtime state
- manual `worktree_cleanup` updates runtime state
- external absolute paths are not silently rewritten into the worktree
- worktree preparation failure blocks execution
- rewrite ambiguity blocks execution
- explicit override allows the scoped root fallback and is visibly recorded
- cleanup advice fires at completion but not on every successful command

## Recommended Implementation Sequence

1. Extract a shared internal core service from the current tool logic.
2. Add a plugin-managed runtime state store.
3. Implement task continuity and binding APIs.
4. Add `tool.execute.before` enforcement.
5. Add Task-tool delegation handling.
6. Add repo-scoped path and workdir rewriting.
7. Add `tool.execute.after` adoption and advisory signaling.
8. Add `command.execute.before` parity handling.
9. Extend the handoff schema with workspace fields.
10. Add `experimental.chat.system.transform` context injection.
11. Add invariant-focused tests.

## Suggested GitHub Tracking Breakdown

Track the work as separate but ordered issues:

1. Core service extraction and runtime state store
2. Task binding and continuity resolution
3. `tool.execute.before` enforcement and mutation classification
4. Delegation interception and handoff workspace contract
5. Path and workdir rewriting
6. Manual tool and slash-command parity
7. Advisory cleanup integration and task lifecycle updates
8. Prompt-context injection and tests

## Definition of Done

- The harness, not the skill, is the authoritative enforcement layer for workspace isolation.
- Orchestrated editable work reliably lands in a task-scoped worktree.
- Linear flows reuse one worktree by default.
- Cleanup remains advisory-only.
- Public tools and slash commands still work, but all paths converge on one shared lifecycle model.
