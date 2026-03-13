import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CliIo } from "../src/cli/program.js";
import type { CliConfig } from "../src/config.js";
import type { RunCommand, RunResult } from "../src/types.js";

export function setupRuntime() {
  const rootRaw = fs.mkdtempSync(path.join(os.tmpdir(), "mat-cli-test-"));
  const heapRaw = path.join(rootRaw, "heap.hprof");
  fs.writeFileSync(heapRaw, "heap");

  const root = fs.realpathSync(rootRaw);
  const heap = fs.realpathSync(heapRaw);
  const launcher = path.join(root, "org.eclipse.equinox.launcher_1.0.0.jar");
  fs.writeFileSync(launcher, "jar");

  const config: CliConfig = {
    allowedRoots: [root],
    matLauncher: launcher,
    matHome: undefined,
    javaPath: "java",
    defaultXmxMb: 4096,
    defaultTimeoutSec: 300,
    matConfigDir: path.join(root, "config"),
    matDataDir: path.join(root, "workspace"),
    debug: false,
    debugLogDir: path.join(root, "logs"),
    privacyMode: false,
    oqlMaxBytes: 16 * 1024,
    resultPreviewLines: 20,
    stdioTailChars: 1000
  };

  fs.mkdirSync(config.matConfigDir, { recursive: true });
  fs.mkdirSync(config.matDataDir, { recursive: true });

  return { root, heap, launcher, config };
}

export function successRunResult(command: RunCommand, overrides: Partial<RunResult> = {}): RunResult {
  return {
    command: command.command,
    args: command.args,
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "ok",
    stderr: "",
    durationMs: 10,
    ...overrides
  };
}

export function createIoCapture(): { io: CliIo; stdout: () => string; stderr: () => string } {
  let stdout = "";
  let stderr = "";

  return {
    io: {
      stdout: {
        write(text: string) {
          stdout += text;
        }
      },
      stderr: {
        write(text: string) {
          stderr += text;
        }
      }
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

export function createEnv(root: string, launcher: string): NodeJS.ProcessEnv {
  return {
    MAT_ALLOWED_ROOTS: root,
    MAT_LAUNCHER: launcher
  };
}
