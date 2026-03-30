"use strict";

async function loadPlugin() {
  const mod = await import("./src/index.js");
  return mod.default || mod.WorktreeWorkflowPlugin;
}

async function WorktreeWorkflowPlugin(...args) {
  const plugin = await loadPlugin();
  if (typeof plugin !== "function") {
    throw new TypeError("Plugin export is not a function");
  }
  return plugin(...args);
}

module.exports = WorktreeWorkflowPlugin;
module.exports.default = WorktreeWorkflowPlugin;
module.exports.WorktreeWorkflowPlugin = WorktreeWorkflowPlugin;
