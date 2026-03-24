# Worktree workflow

This local OpenCode workflow adds two slash commands:

- `/wt-new <descriptive title>` creates a new git worktree from the latest commit on the default branch.
- `/wt-clean` previews merged worktrees that are safe to remove.
- `/wt-clean apply` removes the previewed worktrees and deletes their local branches.

## Optional configuration

The plugin works with zero config.

If you want per-project overrides, add either:

- a `worktreeWorkflow` block in `opencode.json` or `opencode.jsonc`, or
- a sidecar file at `.opencode/worktree-workflow.json`

Example:

```json
{
  "worktreeWorkflow": {
    "branchPrefix": "feature/",
    "remote": "origin",
    "worktreeRoot": "../worktrees/$REPO",
    "cleanupMode": "preview",
    "protectedBranches": ["release"]
  }
}
```

Supported settings:

- `branchPrefix`: branch prefix for generated branches
- `remote`: remote used for default-branch detection and fetch
- `worktreeRoot`: where new worktrees are created; supports `$REPO`, `$ROOT`, and `$ROOT_PARENT`
- `cleanupMode`: default cleanup mode, `preview` or `apply`
- `protectedBranches`: branches that should never be auto-cleaned
