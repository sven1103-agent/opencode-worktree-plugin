import test from "node:test";
import assert from "node:assert/strict";

import { __internal } from "../src/index.js";

test("normalizeCleanupArgs respects explicit apply mode", () => {
  assert.deepEqual(__internal.normalizeCleanupArgs({ mode: "apply", selectors: [] }, { cleanupMode: "preview" }), {
    mode: "apply",
    selectors: [],
  });
});

test("normalizeCleanupArgs falls back to preview config when no args are provided", () => {
  assert.deepEqual(__internal.normalizeCleanupArgs({ raw: "" }, { cleanupMode: "preview" }), {
    mode: "preview",
    selectors: [],
  });
});

test("normalizeCleanupArgs falls back to apply config when no args are provided", () => {
  assert.deepEqual(__internal.normalizeCleanupArgs({ raw: "" }, { cleanupMode: "apply" }), {
    mode: "apply",
    selectors: [],
  });
});

test("normalizeCleanupArgs accepts apply from selectors", () => {
  assert.deepEqual(__internal.normalizeCleanupArgs({ selectors: ["apply"] }, { cleanupMode: "preview" }), {
    mode: "apply",
    selectors: [],
  });
});

test("normalizeCleanupArgs accepts raw apply", () => {
  assert.deepEqual(__internal.normalizeCleanupArgs({ raw: "apply" }, { cleanupMode: "preview" }), {
    mode: "apply",
    selectors: [],
  });
});

test("normalizeCleanupArgs parses raw apply with selectors", () => {
  assert.deepEqual(
    __internal.normalizeCleanupArgs({ raw: "apply feature/foo /tmp/wt" }, { cleanupMode: "preview" }),
    {
      mode: "apply",
      selectors: ["feature/foo", "/tmp/wt"],
    },
  );
});

test("normalizeCleanupArgs lets raw apply override preview config", () => {
  assert.deepEqual(__internal.normalizeCleanupArgs({ raw: "apply" }, { cleanupMode: "preview" }), {
    mode: "apply",
    selectors: [],
  });
});

test("normalizeCleanupArgs lets raw preview override apply config", () => {
  assert.deepEqual(__internal.normalizeCleanupArgs({ raw: "preview" }, { cleanupMode: "apply" }), {
    mode: "preview",
    selectors: [],
  });
});

test("normalizeCleanupArgs tokenizes selector entries that contain raw command text", () => {
  assert.deepEqual(
    __internal.normalizeCleanupArgs({ selectors: ["apply feature/foo /tmp/wt"] }, { cleanupMode: "preview" }),
    {
      mode: "apply",
      selectors: ["feature/foo", "/tmp/wt"],
    },
  );
});

test("parseCleanupRawArguments leaves unknown raw tokens as selectors", () => {
  assert.deepEqual(__internal.parseCleanupRawArguments("feature/foo"), {
    mode: null,
    selectors: ["feature/foo"],
  });
});

test("parseCleanupRawArguments parses preview raw arguments", () => {
  assert.deepEqual(__internal.parseCleanupRawArguments("preview feature/foo"), {
    mode: "preview",
    selectors: ["feature/foo"],
  });
});
