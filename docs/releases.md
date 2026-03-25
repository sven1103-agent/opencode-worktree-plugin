# Release Transparency Guide

This project ships releases in two places:

- npm package: `@sven1103/opencode-worktree-workflow`
- GitHub Release assets: `wt-new.md`, `wt-clean.md`, and `SKILL.md`

This guide explains what those artifacts contain, how they are produced, and what you can verify before installing them.

## What you get from a release

### npm package

The npm package is the installable distribution unit for this project.

It contains the publishable source from `src/`, checked-in schemas from `schemas/`, co-shipped skill files from `skills/`, and package metadata from `package.json`.

It does not include the local development helpers under `.opencode/` because the package is intentionally limited by the root `package.json` `files` field.

Once installed, it can be used in two ways:

- as an OpenCode plugin when referenced from your OpenCode config
- as a local CLI fallback via `npx opencode-worktree-workflow ...`

When used as a plugin, it provides these tools:

- `worktree_prepare`
- `worktree_cleanup`

### GitHub Release assets

Each GitHub Release also attaches these ready-to-download markdown artifacts:

- `wt-new.md`
- `wt-clean.md`
- `SKILL.md`

These files are plain markdown artifacts meant for OpenCode command or skill locations, depending on the file.

They are not compiled binaries and they do not install the package by themselves. The slash commands are convenience wrappers around the plugin tools, and the skill is a policy layer over the same capability, so they are most useful when you also install the npm package.

## How a release is produced

Releases are created from the repository default branch, currently `main`.

The automated flow is:

1. A maintainer runs the `Prepare Release` GitHub Actions workflow from `main` and provides a version like `0.2.0`.
2. The workflow creates a branch named `release/v<version>` from that default-branch state.
3. It updates `package.json` and `package-lock.json` if present.
4. It creates a commit named `chore: release v<version>`.
5. It creates and pushes an annotated tag named `v<version>`.
6. It starts the `Publish Package` workflow for that tag.
7. The publish workflow checks that the tag version matches `package.json`, runs `npm install`, runs `npm pack --dry-run`, publishes to npm, and creates or updates the GitHub Release with a short end-user summary, GitHub-generated release notes, and the markdown assets.

That means the npm package and the GitHub Release assets are both tied to the same git tag.

## What end users can verify

Before installing a release, you can verify the version from multiple angles.

### Verify the npm package version

```sh
npm view @sven1103/opencode-worktree-workflow version
```

To inspect the exact files npm would install for the latest published version:

```sh
npm pack @sven1103/opencode-worktree-workflow --dry-run
```

### Verify the GitHub Release assets

Check the latest release page and confirm it contains:

- a tag like `v0.2.0`
- generated release notes describing the tagged changes
- release assets named `wt-new.md`, `wt-clean.md`, and `SKILL.md`

You can also download and inspect the files directly before placing them into your OpenCode commands or skill directories.

### Verify the repository state behind a release

Because releases are tag-based, you can inspect the matching repository snapshot for any published version:

```sh
git fetch origin --tags
git show v0.2.0 --stat
```

If you want to compare the tagged markdown assets with the downloaded release assets, inspect these paths at the same tag:

- `commands/wt-new.md`
- `commands/wt-clean.md`
- `skills/worktree-workflow/SKILL.md`

## What a release does not promise

The release process is intentionally small and explicit. A release does not:

- auto-merge `release/v<version>` back into `main`
- publish hidden extra tooling from `.opencode/`
- bundle unrelated repository files into the npm package
- modify your repository when you download the markdown assets

Installing the npm package or copying the markdown assets only changes the locations where you place those files.

## Recommended install combinations

Choose the release artifact that matches how you use OpenCode:

- plugin tools only: install the npm package and reference it from your OpenCode config
- CLI fallback only: install the npm package and run `npx opencode-worktree-workflow ...`
- slash commands only: download `wt-new.md` and `wt-clean.md`
- skill only: download `SKILL.md` into a `worktree-workflow/` skill folder if you want the policy layer without the command wrappers
- full setup: install the npm package and also download the slash commands and skill

For most users, the clearest setup is: install the npm package once, enable the plugin if your environment supports it, and treat the local CLI as the fallback path from that same installed package.

## If something looks off

Treat a release as suspicious and pause installation if any of these do not line up:

- npm version and GitHub tag disagree
- GitHub Release is missing one of the command or skill assets
- downloaded markdown files do not match the tagged repository contents you expect
- release notes or tag history suggest the release did not come from `main`

In that case, open an issue and include the tag, the URLs you checked, and the command output you used to verify the release.
