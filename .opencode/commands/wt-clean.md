---
description: Preview or remove git worktrees
---

Use the `worktree_cleanup` tool.

Requirements:
- Always pass the raw slash-command input as `raw: "$ARGUMENTS"`.
- Call `worktree_cleanup` directly and rely on the package implementation for argument normalization, config loading, preview/apply selection, and cleanup semantics.
- Return the tool result.
