#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createWorktreeWorkflowService } from "./core/worktree-service.js";
import { createRuntimeStateStore } from "./runtime/state-store.js";

const execFileAsync = promisify(execFile);

function shellEscape(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function createShell(cwdBase) {
  const shell = (strings, ...values) => {
    const [firstValue] = values;
    const raw = firstValue?.raw || strings.raw?.join("") || strings.join("");
    let cwd = cwdBase;

    return {
      cwd(nextCwd) {
        cwd = nextCwd;
        return this;
      },
      quiet() {
        return this;
      },
      async nothrow() {
        try {
          const result = await execFileAsync("sh", ["-lc", raw], { cwd });
          return {
            text() {
              return result.stdout;
            },
            stderr: Buffer.from(result.stderr),
            exitCode: 0,
          };
        } catch (error) {
          return {
            text() {
              return error.stdout || "";
            },
            stderr: Buffer.from(error.stderr || ""),
            exitCode: typeof error.code === "number" ? error.code : 1,
          };
        }
      },
    };
  };

  shell.escape = shellEscape;
  return shell;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  opencode-worktree-workflow wt-new <title> [--json]",
      "  opencode-worktree-workflow wt-clean [preview|apply] [selectors...] [--json]",
      "",
      "Examples:",
      "  opencode-worktree-workflow wt-new \"Improve checkout retry logic\"",
      "  opencode-worktree-workflow wt-clean preview",
      "  opencode-worktree-workflow wt-clean apply feature/foo",
    ].join("\n") + "\n",
  );
}

function printSubcommandUsage(command) {
  if (command === "wt-new") {
    process.stdout.write(
      [
        "Usage:",
        "  opencode-worktree-workflow wt-new <title> [--json]",
        "",
        "Create a synced worktree and branch from the configured base branch.",
      ].join("\n") + "\n",
    );
    return;
  }

  if (command === "wt-clean") {
    process.stdout.write(
      [
        "Usage:",
        "  opencode-worktree-workflow wt-clean [preview|apply] [selectors...] [--json]",
        "",
        "Preview connected worktrees or remove safe and explicitly selected review worktrees.",
      ].join("\n") + "\n",
    );
  }
}

export function parseCliArgs(argv) {
  const outputJson = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");
  return { outputJson, args };
}

export async function run(argv = process.argv.slice(2)) {
  const { outputJson, args } = parseCliArgs(argv);
  const [command, ...rest] = args;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printUsage();
    process.exitCode = command ? 0 : 1;
    return;
  }

  if ((command === "wt-new" || command === "wt-clean") && rest.some((arg) => arg === "--help" || arg === "-h" || arg === "help")) {
    printSubcommandUsage(command);
    return;
  }

  const shell = createShell(process.cwd());
  const git = async (args, options = {}) => {
    const cwd = options.cwd ?? process.cwd();
    const command = `git ${args.map((arg) => shell.escape(String(arg))).join(" ")}`;
    const result = await shell`${{ raw: command }}`.cwd(cwd).quiet().nothrow();
    const stdout = result.text().trim();
    const stderr = result.stderr.toString("utf8").trim();
    if (!options.allowFailure && result.exitCode !== 0) {
      throw new Error(stderr || stdout || `Git command failed: ${command}`);
    }
    return { stdout, stderr, exitCode: result.exitCode };
  };
  const service = createWorktreeWorkflowService({
    directory: process.cwd(),
    git,
    stateStore: createRuntimeStateStore(),
  });

  let result;
  let structuredResult = null;

  if (command === "wt-new") {
    const title = rest.join(" ").trim();

    if (!title) {
      throw new Error("wt-new requires a descriptive title.");
    }

    structuredResult = await service.prepare({ title, sessionID: "cli" });
    result = structuredResult.message;
  } else if (command === "wt-clean") {
    const raw = rest.join(" ").trim();
    structuredResult = await service.cleanup({ raw, selectors: [], worktree: process.cwd(), sessionID: "cli" });
    result = structuredResult.message;
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  if (outputJson) {
    process.stdout.write(`${JSON.stringify(structuredResult ?? { ok: true, message: result }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${result}\n`);
}

export function isInvokedAsScript(argvPath = process.argv[1]) {
  if (!argvPath) {
    return false;
  }

  try {
    return fs.realpathSync(argvPath) === fileURLToPath(import.meta.url);
  } catch {
    return fileURLToPath(import.meta.url) === argvPath;
  }
}

const invokedAsScript = isInvokedAsScript();

if (invokedAsScript) {
  run().catch((error) => {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
