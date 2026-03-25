---
name: worktree-workflow
description: Decide when to isolate work in a git worktree and use the standard worktree capability safely.
---

Use this skill when work should be isolated from the current checkout, especially for substantial tasks, risky edits, or tasks that may involve multiple collaborating agents.

Goals:
- keep user work isolated from the repo root when appropriate
- prefer task-scoped worktrees for non-trivial editable work
- support both native plugin tools and CLI fallback environments
- keep policy in the skill and execution semantics in the package

Root policy:
- treat repo root as shared space
- use repo root only for tiny, root-safe tasks
- a task is root-safe only if it is one focused change, touches at most one or two closely related files, does not need parallel delegation, does not imply a likely edit-test-fix loop, does not involve risky refactoring or migration work, and does not risk interfering with unrelated dirty root state

Task worktree policy:
- for non-trivial editable work, prefer one task-scoped worktree
- a task worktree belongs to a task or workstream, not to a single agent
- planning, implementation, and review for one linear task should usually share the same task worktree
- create a separate divergent worktree only when concurrent branches of work may conflict or need independent experimentation

Capability ladder:
- if the native worktree tools are available, use them as the primary path
- if the native tools are unavailable, use the packaged CLI fallback path
- if no worktree capability is available, continue in repo root only for tiny, root-safe tasks; otherwise stop and explain that isolation capability is unavailable

Creation behavior:
- when creating a worktree, use a short descriptive task title
- after creation, treat the returned `worktree_path` as the active execution target for follow-up work
- for later shell commands, use that worktree path as the working directory
- for later file reads or edits, use paths inside that worktree

Cleanup behavior:
- cleanup is preview-first by default
- use cleanup apply only when deletion is clearly intended and controlled by the orchestrating runtime
- treat slash commands as manual human entry points, not as the canonical agent interface

Boundaries:
- do not encode runtime storage, session artifact, or orchestration file-layout details here
- do not duplicate package argument normalization or config parsing here
- rely on the shared package implementation for config loading, base-branch resolution, cleanup normalization, and structured result semantics
