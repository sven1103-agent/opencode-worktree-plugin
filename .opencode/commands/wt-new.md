---
description: Create a synced git worktree from a descriptive title
---

Use the `worktree_prepare` tool.

Requirements:
- Use `$ARGUMENTS` as the descriptive title.
- Fetch the latest commit from the configured base branch before creating anything, or from the repository default branch when no base branch is configured.
- Create a new git worktree and a matching descriptive branch from the latest configured base-branch commit, or the default branch when no base branch is configured.
- Return the branch name, worktree path, default branch, base branch, base ref, and base commit.
- Treat the returned worktree path as the active execution target for follow-up work in this conversation.
- For later shell commands, use that worktree path as the `workdir`.
- For later file reads or edits, use absolute paths inside that worktree.
- If `$ARGUMENTS` is empty, explain the expected usage with an example such as `/wt-new improve checkout retry logic`.
