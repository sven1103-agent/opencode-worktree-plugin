import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package root resolves to a callable plugin factory for require loaders", async () => {
  const pluginModule = require(repoRoot);

  assert.equal(typeof pluginModule, "function");
  assert.equal(pluginModule, pluginModule.default);
  assert.equal(pluginModule, pluginModule.WorktreeWorkflowPlugin);

  const plugin = await pluginModule({
    $: Object.assign(
      () => ({
        cwd() {
          return this;
        },
        quiet() {
          return this;
        },
        async nothrow() {
          return {
            text() {
              return "";
            },
            stderr: Buffer.from(""),
            exitCode: 0,
          };
        },
      }),
      { escape(value) { return JSON.stringify(String(value)); } },
    ),
    directory: repoRoot,
  });

  assert.equal(typeof plugin, "object");
  assert.equal(typeof plugin.hooks["tool.execute.before"], "function");
});
