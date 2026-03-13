import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RunResult } from "../types.js";

export function persistDebugLog(params: {
  enabled: boolean;
  logDir: string;
  commandName: string;
  run: RunResult;
}): void {
  if (!params.enabled) {
    return;
  }

  fs.mkdirSync(params.logDir, { recursive: true });
  const fileName = `${Date.now()}-${params.commandName}-${crypto.randomUUID()}.json`;
  const logPath = path.join(params.logDir, fileName);
  fs.writeFileSync(
    logPath,
    JSON.stringify(
      {
        command_name: params.commandName,
        duration_ms: params.run.durationMs,
        exit_code: params.run.exitCode,
        signal: params.run.signal,
        timed_out: params.run.timedOut,
        command: params.run.command,
        args: params.run.args,
        stdout: params.run.stdout,
        stderr: params.run.stderr
      },
      null,
      2
    )
  );
}
