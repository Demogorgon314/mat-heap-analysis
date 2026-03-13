import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_MACOS_MAT_HOME, inferDefaultMatHome, loadConfig } from "../src/config.js";

test("loadConfig parses defaults without allowed roots", () => {
  const config = loadConfig({});
  assert.equal(config.allowedRoots.length, 0);
  assert.equal(config.defaultXmxMb, 4096);
  assert.equal(config.defaultTimeoutSec, 1800);
  assert.equal(config.oqlMaxBytes, 16 * 1024);
  assert.equal(config.resultPreviewLines, 20);
});

test("loadConfig prefers flag overrides over environment", () => {
  const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mat-env-root-"));
  const overrideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mat-override-root-"));

  const config = loadConfig(
    {
      MAT_ALLOWED_ROOTS: envRoot,
      MAT_XMX_MB: "2048"
    },
    {
      allowedRoots: [overrideRoot],
      xmxMb: 8192
    }
  );

  assert.deepEqual(config.allowedRoots, [fs.realpathSync(overrideRoot)]);
  assert.equal(config.defaultXmxMb, 8192);
});

test("loadConfig rejects non-directory allowed roots", () => {
  const filePath = path.join(os.tmpdir(), `mat-cli-file-${Date.now()}`);
  fs.writeFileSync(filePath, "x");

  assert.throws(() => loadConfig({}, { allowedRoots: [filePath] }), /must be a directory/i);
});

test("loadConfig infers allowed root from heap parent when none configured", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mat-heap-root-"));
  const heap = path.join(root, "heap.hprof");
  fs.writeFileSync(heap, "heap");

  const config = loadConfig({}, { heapPath: heap });

  assert.deepEqual(config.allowedRoots, [fs.realpathSync(root)]);
});

test("inferDefaultMatHome returns macOS MAT path when present", () => {
  const matHome = inferDefaultMatHome("darwin", (targetPath) => targetPath === DEFAULT_MACOS_MAT_HOME);
  assert.equal(matHome, DEFAULT_MACOS_MAT_HOME);
});
