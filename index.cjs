"use strict";

const plugin = {
  id: "@sven1103/opencode-worktree-workflow",
  async server(...args) {
    const mod = await import("./src/index.js");
    return mod.WorktreeWorkflowPlugin(...args);
  },
};

module.exports = plugin;
module.exports.default = plugin;
