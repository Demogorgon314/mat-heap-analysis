import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli/program.js";
import { DEFAULT_MACOS_MAT_HOME } from "../src/config.js";
import { createEnv, createIoCapture, setupRuntime, successRunResult } from "./helpers.js";

test("runCli prints top-level help with no args", async () => {
  const capture = createIoCapture();
  const exitCode = await runCli([], { io: capture.io });

  assert.equal(exitCode, 0);
  assert.match(capture.stdout(), /Agent-friendly Eclipse MAT CLI/);
  assert.match(capture.stdout(), /Commands:/);
});

test("runCli returns usage help for missing query args", async () => {
  const capture = createIoCapture();
  const exitCode = await runCli(["query"], { io: capture.io });

  assert.equal(exitCode, 2);
  assert.match(capture.stderr(), /query requires --heap <path>/);
  assert.match(capture.stderr(), /Usage:/);
  assert.match(capture.stderr(), /mat query --heap/);
});

test("runCli emits catalog json", async () => {
  const capture = createIoCapture();
  const exitCode = await runCli(["catalog", "commands", "--json"], { io: capture.io });

  assert.equal(exitCode, 0);
  const payload = JSON.parse(capture.stdout());
  assert.equal(payload.command, "catalog");
  assert.equal(payload.section, "commands");
  assert.ok(Array.isArray(payload.commands));
});

test("runCli emits query json on success", async () => {
  const { root, heap, launcher } = setupRuntime();
  const capture = createIoCapture();
  const queryDir = path.join(root, "heap_Query");
  const pagesDir = path.join(queryDir, "pages");

  const exitCode = await runCli(
    ["query", "--heap", heap, "--allowed-root", root, "--query", "SELECT x FROM INSTANCEOF java.lang.String x", "--json"],
    {
      io: capture.io,
      env: createEnv(root, launcher),
      matServiceDeps: {
        runCommand: async (command) => {
          fs.mkdirSync(pagesDir, { recursive: true });
          fs.writeFileSync(path.join(pagesDir, "Query_Command1.txt"), "hello\nworld\n");
          return successRunResult(command);
        }
      }
    }
  );

  assert.equal(exitCode, 0);
  const payload = JSON.parse(capture.stdout());
  assert.equal(payload.command, "query");
  assert.equal(payload.status, "ok");
  assert.deepEqual(payload.result_preview, ["hello", "world"]);
});

test("runCli infers allowed root from --heap parent when no allowlist is configured", async () => {
  const { root, heap, launcher } = setupRuntime();
  const capture = createIoCapture();
  const queryDir = path.join(root, "heap_Query");
  const pagesDir = path.join(queryDir, "pages");

  const exitCode = await runCli(
    ["query", "--heap", heap, "--query", "SELECT x FROM INSTANCEOF java.lang.String x", "--json"],
    {
      io: capture.io,
      env: {
        MAT_LAUNCHER: launcher
      },
      matServiceDeps: {
        runCommand: async (command) => {
          fs.mkdirSync(pagesDir, { recursive: true });
          fs.writeFileSync(path.join(pagesDir, "Query_Command1.txt"), "hello\nworld\n");
          return successRunResult(command);
        }
      }
    }
  );

  assert.equal(exitCode, 0);
  const payload = JSON.parse(capture.stdout());
  assert.equal(payload.command, "query");
  assert.equal(payload.status, "ok");
  assert.deepEqual(payload.result_preview, ["hello", "world"]);
});

test("runCli returns MAT_NOT_FOUND exit code for doctor failure", async () => {
  const capture = createIoCapture();
  const originalExistsSync = fs.existsSync;
  fs.existsSync = ((targetPath: fs.PathLike) => {
    if (String(targetPath) === DEFAULT_MACOS_MAT_HOME) {
      return false;
    }
    return originalExistsSync(targetPath);
  }) as typeof fs.existsSync;

  try {
    const exitCode = await runCli(["doctor"], { io: capture.io, env: {} });

    assert.equal(exitCode, 3);
    assert.match(capture.stderr(), /MAT launcher is not configured/);
    assert.match(capture.stderr(), /\[exit:3/);
  } finally {
    fs.existsSync = originalExistsSync;
  }
});
