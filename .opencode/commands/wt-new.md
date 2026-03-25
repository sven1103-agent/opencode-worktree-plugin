---
description: Create a synced git worktree from a descriptive title
---

Use the `worktree_prepare` tool.

Requirements:
- Use `$ARGUMENTS` as the descriptive title.
- Call `worktree_prepare` directly with `title: "$ARGUMENTS"`.
- Rely on the package implementation for config loading, base-branch resolution, and worktree creation semantics.
- Return the tool result.
- Treat the returned worktree path as the active execution target for follow-up work in this conversation.
- For later shell commands, use that worktree path as the `workdir`.
- For later file reads or edits, use absolute paths inside that worktree.
- If `$ARGUMENTS` is empty, explain the expected usage with an example such as `/wt-new improve checkout retry logic`.
