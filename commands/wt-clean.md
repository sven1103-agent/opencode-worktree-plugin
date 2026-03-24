---
description: Preview or remove git worktrees
---

Use the `worktree_cleanup` tool.

Requirements:
- If `$ARGUMENTS` starts with `apply`, call the tool with `mode: "apply"`.
- Pass any remaining `$ARGUMENTS` tokens after `apply` as the `selectors` array.
- Otherwise call the tool with `mode: "preview"` and `selectors: []`.
- In preview mode, show all connected worktrees grouped as safe to clean, needs review, or not cleanable here.
- In apply mode, remove the safe group automatically and also remove any explicitly selected review items.
- Return either the grouped preview list or the cleanup result.
