import { MatCliError, type RunResult } from "../types.js";
import { tail } from "./runner.js";

const WRITE_PERMISSION_PATTERNS = [
  /permission denied/i,
  /access is denied/i,
  /read-only file system/i,
  /cannot create/i,
  /failed to create/i,
  /lock\.index/i
];

const INVALID_QUERY_PATTERNS = [
  /syntax/i,
  /parse error/i,
  /unexpected token/i,
  /invalid query/i,
  /query command/i
];

function includesPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyRunFailure(run: RunResult, tailChars: number): MatCliError {
  const stdoutTail = tail(run.stdout, tailChars);
  const stderrTail = tail(run.stderr, tailChars);
  const merged = `${stdoutTail}\n${stderrTail}`;

  if (run.timedOut) {
    return new MatCliError({
      category: "MAT_TIMEOUT",
      message: `MAT process exceeded timeout (${Math.round(run.durationMs / 1000)}s).`,
      hint: "Increase --timeout-sec or run a smaller report/query.",
      stdoutTail,
      stderrTail,
      exitCode: run.exitCode
    });
  }

  if (includesPattern(merged, WRITE_PERMISSION_PATTERNS)) {
    return new MatCliError({
      category: "WRITE_PERMISSION_DENIED",
      message: "MAT could not write lock/index/report artifacts near the heap dump.",
      hint: "Grant write permission on the heap directory or analyze a copy in writable storage.",
      stdoutTail,
      stderrTail,
      exitCode: run.exitCode
    });
  }

  const likelyInvalidQuery = includesPattern(merged, INVALID_QUERY_PATTERNS) && /oql/i.test(merged);
  if (likelyInvalidQuery) {
    return new MatCliError({
      category: "INVALID_QUERY",
      message: "MAT rejected the OQL query.",
      hint: "Validate OQL syntax and use `mat catalog oql` for parser-safe query patterns.",
      stdoutTail,
      stderrTail,
      exitCode: run.exitCode
    });
  }

  return new MatCliError({
    category: "MAT_PARSE_FAILED",
    message: "MAT exited with a non-zero status.",
    hint: "Inspect stderr in the result for MAT diagnostics.",
    stdoutTail,
    stderrTail,
    exitCode: run.exitCode
  });
}

export function classifySpawnError(error: unknown): MatCliError {
  const message = error instanceof Error ? error.message : String(error);
  return new MatCliError({
    category: "MAT_NOT_FOUND",
    message: `Failed to launch MAT process: ${message}`,
    hint: "Verify JAVA_PATH and MAT_LAUNCHER are valid and executable."
  });
}
