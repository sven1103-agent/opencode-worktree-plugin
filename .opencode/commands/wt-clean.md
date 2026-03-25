---
description: Preview or remove git worktrees
---

Use the `worktree_cleanup` tool.

Requirements:
- Always pass the raw slash-command input as `raw: "$ARGUMENTS"`.
- If `$ARGUMENTS` is exactly `apply`, call `worktree_cleanup` with `raw: "apply"`.
- If `$ARGUMENTS` starts with `apply `, call `worktree_cleanup` with `raw: "$ARGUMENTS"`.
- Otherwise call `worktree_cleanup` with `raw: "$ARGUMENTS"`, `mode: "preview"`, and `selectors: []`.
- In preview mode, show all connected worktrees grouped as safe to clean, needs review, or not cleanable here.
- In apply mode, remove the safe group automatically and also remove any explicitly selected review items.
- Return either the grouped preview list or the cleanup result.
