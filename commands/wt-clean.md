---
description: Preview or remove merged git worktrees
---

Use the `worktree_cleanup` tool.

Requirements:
- If `$ARGUMENTS` contains `apply`, call the tool with `mode: "apply"`.
- Otherwise call the tool with `mode: "preview"`.
- Keep cleanup limited to worktrees whose branches are already merged into the default branch.
- Return either the preview list or the cleanup result.
