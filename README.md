# OpenCode Worktree Workflow

`@sven1103/opencode-worktree-workflow` is an OpenCode plugin that adds git worktree helpers for creating synced feature worktrees and cleaning up merged ones.

## Install in an OpenCode project

Add the package as a project dependency, following the official docs style:

```json
{
  "dependencies": {
    "@sven1103/opencode-worktree-workflow": "^0.2.0"
  }
}
```

Then reference the installed package from your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@sven1103/opencode-worktree-workflow"]
}
```

Keeping the npm dependency in `package.json` makes the installation more durable even if shared `opencode.json` bundles overwrite plugin entries.

If you do not already install dependencies in your project, you can add the package directly with npm:

```sh
npm install @sven1103/opencode-worktree-workflow
```

## Install slash commands

OpenCode loads custom commands from either `.opencode/commands/` (project) or `~/.config/opencode/commands/` (global).

This repo publishes `wt-new.md` and `wt-clean.md` as GitHub Release assets so you can install them without browsing the repository.
For a plain-language explanation of what each release contains, how it is produced, and how to verify it before installing, see `docs/releases.md`.

Project install (latest release):

```sh
mkdir -p .opencode/commands
curl -fsSL "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/latest/download/wt-new.md"  -o ".opencode/commands/wt-new.md"
curl -fsSL "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/latest/download/wt-clean.md" -o ".opencode/commands/wt-clean.md"
```

```sh
mkdir -p .opencode/commands
wget -qO ".opencode/commands/wt-new.md"  "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/latest/download/wt-new.md"
wget -qO ".opencode/commands/wt-clean.md" "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/latest/download/wt-clean.md"
```

Global install (latest release):

```sh
mkdir -p ~/.config/opencode/commands
curl -fsSL "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/latest/download/wt-new.md"  -o "$HOME/.config/opencode/commands/wt-new.md"
curl -fsSL "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/latest/download/wt-clean.md" -o "$HOME/.config/opencode/commands/wt-clean.md"
```

```sh
mkdir -p ~/.config/opencode/commands
wget -qO "$HOME/.config/opencode/commands/wt-new.md"  "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/latest/download/wt-new.md"
wget -qO "$HOME/.config/opencode/commands/wt-clean.md" "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/latest/download/wt-clean.md"
```

Pinned to a specific release tag:

```sh
VERSION=v0.1.0
mkdir -p .opencode/commands
curl -fsSL "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/download/${VERSION}/wt-new.md"  -o ".opencode/commands/wt-new.md"
curl -fsSL "https://github.com/sven1103-agent/opencode-worktree-plugin/releases/download/${VERSION}/wt-clean.md" -o ".opencode/commands/wt-clean.md"
```

## What the plugin provides

- `worktree_prepare`: create a worktree and matching branch from the latest configured base-branch commit, or the default branch when no base branch is configured
- `worktree_cleanup`: preview all connected worktrees against the configured base branch, auto-clean safe ones, and optionally remove selected review items

This package currently focuses on plugin distribution. Slash command packaging can be layered on later.

## Optional project configuration

OpenCode's native `opencode.json` and `opencode.jsonc` files are schema-validated, so they can load this plugin through the standard `plugin` key but they cannot store a custom `worktreeWorkflow` block.

To override this plugin's defaults, put a sidecar config file at `.opencode/worktree-workflow.json`:

```json
{
  "branchPrefix": "wt/",
  "remote": "origin",
  "baseBranch": "release/v0.4.0",
  "worktreeRoot": ".worktrees/$REPO",
  "cleanupMode": "preview",
  "protectedBranches": ["release"]
}
```

Use `opencode.json` only to load the npm plugin itself:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@sven1103/opencode-worktree-workflow"]
}
```

Supported settings:

- `branchPrefix`: prefix for generated worktree branches
- `remote`: remote used to detect the default branch and fetch updates
- `baseBranch`: optional branch name used as the creation and cleanup base; defaults to the remote's default branch
- `worktreeRoot`: destination root for new worktrees; supports `$REPO`, `$ROOT`, and `$ROOT_PARENT`
- `cleanupMode`: default cleanup behavior, either `preview` or `apply`
- `protectedBranches`: branches that should never be auto-cleaned

## Publish workflow

This repo is prepared for npm publishing from GitHub Actions using npm trusted publishing.

If you consume releases instead of contributing to the repo, `docs/releases.md` is the end-user guide for understanding what the published npm package and GitHub Release assets include.

Typical release flow:

1. Publish the package once manually to create it on npm.
2. Configure the package's trusted publisher on npm for `.github/workflows/publish.yml`.
3. Run the `Prepare Release` workflow from `main` with a version like `0.2.0`.

The release workflow creates a `release/v<version>` branch from `main`, updates `package.json` and `package-lock.json`, commits the version bump there, creates a matching `v<version>` tag, and pushes the branch and tag.

The release workflow then explicitly starts the publish workflow for that tag, which verifies the tag matches `package.json`, runs `npm publish` using OIDC without storing an `NPM_TOKEN` secret, and creates or updates the GitHub Release with generated release notes plus the command assets. Merge the release branch back to `main` afterward if you want the version bump recorded on the default branch.

## Local development

The repo still contains a project-local `.opencode/` setup for development and testing:

- `.opencode/plugins/worktree.js` re-exports the plugin from `src/index.js`
- `.opencode/commands/` contains local slash command wrappers for manual testing
- `.opencode/worktree-workflow.md` documents the local workflow

The publishable npm artifact is limited to `src/` via the root `package.json` `files` field. Install dependencies at the repo root with `npm install` for local development.
