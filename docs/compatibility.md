# Compatibility Model

This repo currently ships four closely related layers:

- native plugin tools
- CLI fallback
- slash commands
- co-shipped skill

They share one core rule: package implementation is the source of truth for config loading, argument normalization, and worktree execution semantics.

## Current compatibility contract

- Native tools return human-readable text and publish the structured result in metadata.
- CLI `--json` output prints the same structured, versioned contract directly.
- Slash commands are first-class human entry points, but they should stay thin and defer behavior to the package.
- The co-shipped skill should target the documented contract, not package internals.

## Co-shipped skill contract

- The skill is packaged in `skills/worktree-workflow/SKILL.md`.
- The skill should remain policy-only: when to isolate work, when repo root is acceptable, and when to prefer preview-first cleanup.
- The skill must not encode orchestration storage details such as session folders or workspace registries.
- The skill must not duplicate package config parsing or argument normalization logic.
- The skill can later move to a separate repo without changing its behavioral contract.

## Configuration compatibility

Existing installations must keep working.

- Preserve the existing plugin configuration contract and behavior.
- Keep config loading and precedence centralized in the package implementation.
- Do not move config parsing into slash commands.
- Do not duplicate config parsing in the CLI.
- Do not change existing config keys, defaults, or precedence order without explicit versioning and documentation.
- Existing `.opencode/worktree-workflow.json` setups should continue to work across native tools, CLI fallback, and slash commands through the shared package logic.

## Recommended install model

- Best experience: install the npm package once and enable the native plugin tools.
- Mixed environments: use the CLI from the same installed package as the fallback path.
- Human UX: install slash commands when users want explicit manual triggers.

## Separation of responsibility

- Package: config, normalization, execution semantics, structured results
- CLI: human-oriented fallback surface over the package contract
- Slash commands: thin wrappers over the package contract
- Skill: policy for when to use worktrees, not implementation mechanics
- Orchestrator/runtime: workspace selection, delegation context, lifecycle handling
