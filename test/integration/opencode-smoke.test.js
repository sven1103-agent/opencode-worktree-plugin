import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode";
const PUBLISHED_PLUGIN_SPEC = process.env.OPENCODE_SMOKE_PUBLISHED_SPEC;

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body), body });
        } catch (error) {
          reject(new Error(`Failed to parse JSON response from ${url}: ${body}`));
        }
      });
    });
    req.on("error", reject);
  });
}

function isLatestLikeSpecifier(spec) {
  if (!spec) return false;
  if (spec.endsWith("@latest")) return true;
  return spec.indexOf("@", 1) === -1;
}

async function unpackPackedPlugin() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-plugin-smoke-"));
  const unpackDir = path.join(tempRoot, "unpacked");
  await fs.mkdir(unpackDir, { recursive: true });

  const packed = JSON.parse((await execFileAsync("npm", ["pack", "--json", "--pack-destination", tempRoot], { cwd: repoRoot })).stdout);
  const tarballPath = path.join(tempRoot, packed[0].filename);
  await execFileAsync("tar", ["-xzf", tarballPath, "-C", unpackDir]);
  await execFileAsync("npm", ["install", "--omit=dev"], { cwd: path.join(unpackDir, "package") });

  return {
    tempRoot,
    packageDir: path.join(unpackDir, "package"),
    async cleanup() {
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function startOpencodeServer(pluginRef) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-smoke-"));
  const projectDir = path.join(tempRoot, "project");
  const homeDir = path.join(tempRoot, "home");
  const xdgDir = path.join(tempRoot, "xdg");
  const configDir = path.join(xdgDir, "opencode");
  const port = 4100 + Math.floor(Math.random() * 1000);

  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "opencode.json"),
    `${JSON.stringify({ plugin: [pluginRef] }, null, 2)}\n`,
    "utf8",
  );

  const env = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: xdgDir,
    OPENCODE_CONFIG_DIR: configDir,
  };

  const child = spawn(OPENCODE_BIN, ["serve", "--print-logs", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectDir,
    env,
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  return {
    port,
    projectDir,
    readLogs() {
      return logs;
    },
    async stop() {
      if (!child.killed) child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function waitForToolIDs(port, attempts = 40) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await requestJson(`http://127.0.0.1:${port}/experimental/tool/ids`);
      if (response.status === 200 && Array.isArray(response.json)) return response.json;
      lastError = new Error(`Unexpected response: ${response.status} ${response.body}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error("Timed out waiting for OpenCode tool ids");
}

test("packed plugin loads in isolated opencode and registers custom tools", { timeout: 60000 }, async () => {
  const packed = await unpackPackedPlugin();
  const server = await startOpencodeServer(`file://${packed.packageDir}`);

  try {
    const toolIDs = await waitForToolIDs(server.port);
    const logs = server.readLogs();

    assert.match(logs, /loading plugin/);
    assert.doesNotMatch(logs, /Failed to load plugin/i);
    assert.doesNotMatch(logs, /Plugin export is not a function/i);
    assert.ok(toolIDs.includes("worktree_prepare"), `Expected worktree_prepare in tool ids: ${JSON.stringify(toolIDs)}`);
    assert.ok(toolIDs.includes("worktree_cleanup"), `Expected worktree_cleanup in tool ids: ${JSON.stringify(toolIDs)}`);
  } finally {
    await server.stop();
    await packed.cleanup();
  }
});

const publishedTest = PUBLISHED_PLUGIN_SPEC ? test : test.skip;

publishedTest("published plugin spec reproduces current load status in isolated opencode", { timeout: 60000 }, async () => {
  const server = await startOpencodeServer(PUBLISHED_PLUGIN_SPEC || "");

  try {
    const toolIDs = await waitForToolIDs(server.port);
    const logs = server.readLogs();

    assert.match(logs, /loading plugin/);

    if (isLatestLikeSpecifier(PUBLISHED_PLUGIN_SPEC)) {
      assert.match(logs, /Plugin export is not a function/i);
      assert.ok(!toolIDs.includes("worktree_prepare"), `Did not expect worktree_prepare in tool ids: ${JSON.stringify(toolIDs)}`);
      assert.ok(!toolIDs.includes("worktree_cleanup"), `Did not expect worktree_cleanup in tool ids: ${JSON.stringify(toolIDs)}`);
      return;
    }

    assert.doesNotMatch(logs, /Failed to load plugin/i);
    assert.doesNotMatch(logs, /Plugin export is not a function/i);
    assert.ok(toolIDs.includes("worktree_prepare"), `Expected worktree_prepare in tool ids: ${JSON.stringify(toolIDs)}`);
    assert.ok(toolIDs.includes("worktree_cleanup"), `Expected worktree_cleanup in tool ids: ${JSON.stringify(toolIDs)}`);
  } finally {
    await server.stop();
  }
});
