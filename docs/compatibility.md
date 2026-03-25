# Compatibility Model

This repo currently ships four closely related layers:

- native plugin tools
- CLI fallback
- slash commands
- co-shipped skill

They share one core rule: package implementation is the source of truth for config loading, argument normalization, and worktree execution semantics.

## Current compatibility contract

- Native tools are the canonical machine interface.
- CLI `--json` output uses the same structured, versioned contract as the native tools.
- Slash commands are first-class human entry points, but they should stay thin and defer behavior to the package.
- The co-shipped skill should target the documented contract, not package internals.

## Configuration compatibility

Existing installations must keep working.

- Preserve the existing plugin configuration contract and behavior.
- Keep config loading and precedence centralized in the package implementation.
- Do not move config parsing into slash commands.
- Do not duplicate config parsing in the CLI.
- Do not change existing config keys, defaults, or precedence order without explicit versioning and documentation.
- Existing `.opencode/worktree-workflow.json` setups should continue to work across native tools, CLI fallback, and slash commands through the shared package logic.

## Recommended install model

- Best experience: install the npm package and native plugin tools.
- Mixed environments: use the CLI via `bunx` as the fallback path.
- Human UX: install slash commands when users want explicit manual triggers.

## Separation of responsibility

- Package: config, normalization, execution semantics, structured results
- CLI: human-oriented fallback surface over the package contract
- Slash commands: thin wrappers over the package contract
- Skill: policy for when to use worktrees, not implementation mechanics
- Orchestrator/runtime: workspace selection, delegation context, lifecycle handling
