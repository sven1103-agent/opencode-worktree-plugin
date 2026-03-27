import test from "node:test";
import assert from "node:assert/strict";

import { __internal } from "../src/index.js";

test("decideContinuity reuses active task for clear continuation", () => {
  const decision = __internal.decideContinuity({ hasActiveTask: true, continuationSignal: true });
  assert.deepEqual(decision, { decision: "reuse-active", reason: "clear-continuation" });
});

test("decideContinuity asks user when ambiguous", () => {
  const decision = __internal.decideContinuity({ hasActiveTask: true, ambiguous: true });
  assert.deepEqual(decision, { decision: "ask-user", reason: "ambiguous-continuity" });
});

test("decideContinuity creates new for distinct objective", () => {
  const decision = __internal.decideContinuity({ hasActiveTask: true, distinctObjectiveSignal: true });
  assert.deepEqual(decision, { decision: "create-new", reason: "distinct-objective" });
});

test("inferTaskLifecycleTransition only changes on explicit signal", () => {
  assert.equal(__internal.inferTaskLifecycleTransition({ currentStatus: "active", explicitSignal: "none" }), "active");
  assert.equal(__internal.inferTaskLifecycleTransition({ currentStatus: "active", explicitSignal: "complete" }), "completed");
});
