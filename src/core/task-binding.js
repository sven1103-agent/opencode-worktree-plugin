export function decideContinuity({ hasActiveTask = false, continuationSignal = false, distinctObjectiveSignal = false, alternativeRequested = false, ambiguous = false } = {}) {
  if (!hasActiveTask) {
    return { decision: "create-new", reason: "no-active-task" };
  }

  if (distinctObjectiveSignal || alternativeRequested) {
    return { decision: "create-new", reason: alternativeRequested ? "alternative-requested" : "distinct-objective" };
  }

  if (ambiguous) {
    return { decision: "ask-user", reason: "ambiguous-continuity" };
  }

  if (continuationSignal) {
    return { decision: "reuse-active", reason: "clear-continuation" };
  }

  return { decision: "ask-user", reason: "insufficient-signal" };
}

export function inferTaskLifecycleTransition({ currentStatus = "inactive", explicitSignal = "none" } = {}) {
  if (explicitSignal === "activate") return "active";
  if (explicitSignal === "deactivate") return "inactive";
  if (explicitSignal === "complete") return "completed";
  if (explicitSignal === "block") return "blocked";
  return currentStatus;
}
