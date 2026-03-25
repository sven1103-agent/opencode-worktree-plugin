# Structured Result Contract

The worktree workflow package now exposes a structured result contract for CLI `--json` mode and for native-tool metadata. Native tools return human-readable text, while the same structured object is published in metadata for machine consumers. Callers should treat the structured fields as the canonical interface.

## Versioning

- Current `schema_version`: `1.0.0`
- Every structured result emitted by `worktree_prepare` and `worktree_cleanup` includes `schema_version`.
- Future breaking changes should increment the schema version deliberately rather than silently reshaping fields.

## Result Families

The repo currently publishes three checked-in JSON Schemas for transparency:

- `schemas/worktree-prepare.result.schema.json`
- `schemas/worktree-cleanup-preview.result.schema.json`
- `schemas/worktree-cleanup-apply.result.schema.json`

## Required Result Shapes

### `worktree_prepare`

Required top-level fields:

- `schema_version`
- `ok`
- `title`
- `branch`
- `worktree_path`
- `default_branch`
- `base_branch`
- `base_ref`
- `base_commit`
- `created`

Optional presentation field:

- `message`

### `worktree_cleanup` preview

Required top-level fields:

- `schema_version`
- `ok`
- `mode`
- `default_branch`
- `base_branch`
- `base_ref`
- `groups`

Required groups:

- `groups.safe`
- `groups.review`
- `groups.blocked`

Per-item fields:

- `branch`
- `worktree_path`
- `head`
- `status`
- `reason`
- `detached`
- `selectable`

Optional presentation field:

- `message`

### `worktree_cleanup` apply

Required top-level fields:

- `schema_version`
- `ok`
- `mode`
- `default_branch`
- `base_branch`
- `base_ref`
- `requested_selectors`
- `removed`
- `failed`

Removed item fields:

- `branch`
- `worktree_path`
- `head`
- `status`
- `reason`
- `detached`
- `selectable`
- `selected`

Failed item fields:

- `selector`
- `branch`
- `worktree_path`
- `status`
- `reason`
- `detached`
- `selectable`

Optional presentation field:

- `message`

## Semantics

- `ok: true` means the operation executed and returned a valid result object.
- Cleanup `apply` may still contain partial failures in `failed` while remaining `ok: true`.
- `ok: false` should be reserved for top-level inability to perform the operation at all.
- `message` is for humans; automation should depend on the structured fields.
