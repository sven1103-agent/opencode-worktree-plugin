# Worktree workflow

This local OpenCode workflow adds two slash commands for development and testing:

- `/wt-new <descriptive title>` creates a new git worktree from the latest commit on the configured base branch, or the default branch when no base branch is configured.
- After `/wt-new`, use the returned worktree path as the active target for follow-up work by passing it as bash `workdir` and by using absolute file paths inside that worktree.
- `/wt-clean` previews all connected worktrees, grouped into safe to clean, needs review, and not cleanable here.
- `/wt-clean apply` removes the safe group and deletes their local branches.
- `/wt-clean apply <branch-or-path>` also removes explicitly selected review items.

## Optional configuration

The plugin works with zero config.

If you want per-project overrides, use a sidecar file at `.opencode/worktree-workflow.json`.

You can start from the checked-in example at `.opencode/worktree-workflow.example.json`.

Do not add a top-level `worktreeWorkflow` block to `opencode.json` or `opencode.jsonc`. OpenCode validates those files against its own schema and rejects unknown top-level keys.

Example:

```json
{
  "branchPrefix": "feature/",
  "remote": "origin",
  "baseBranch": "release/v0.4.0",
  "worktreeRoot": "../worktrees/$REPO",
  "cleanupMode": "preview",
  "protectedBranches": ["release"]
}
```

Use the standard OpenCode config only to load the plugin:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@sven1103/opencode-worktree-workflow"]
}
```

Supported settings:

- `branchPrefix`: branch prefix for generated branches
- `remote`: remote used for default-branch detection and fetch
- `baseBranch`: optional branch name used as the creation and cleanup base; defaults to the remote's default branch
- `worktreeRoot`: where new worktrees are created; supports `$REPO`, `$ROOT`, and `$ROOT_PARENT`
- `cleanupMode`: default cleanup mode, `preview` or `apply`
- `protectedBranches`: branches that should never be auto-cleaned

## Development note

The publishable npm package lives at the repository root.

- The actual plugin source is `src/index.js`.
- `.opencode/plugins/worktree.js` is a local re-export shim for OpenCode project testing.
- Install dependencies with `npm install` at the repository root.
