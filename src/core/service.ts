import fs from "node:fs";
import { ALLOWED_COMMANDS, ALLOWED_REPORT_IDS } from "../catalog.js";
import type { CliConfig } from "../config.js";
import { MatCliError, type MatErrorResponse, type MatHealthcheckSuccess, type MatIndexStatusSuccess, type MatOqlQuerySuccess, type MatOqlSpecSuccess, type MatParseReportSuccess, type MatRunCommandSuccess, type RunCommand, type RunResult } from "../types.js";
import { resolveIndexArtifacts, resolveQueryArtifacts, resolveReportArtifacts } from "./artifacts.js";
import { buildGenericCommand, buildOqlCommand, buildParseReportCommand } from "./commandBuilder.js";
import { persistDebugLog } from "./debugLog.js";
import { classifyRunFailure, classifySpawnError } from "./errorClassifier.js";
import { detectJavaVersion, resolveMatLauncher } from "./launcher.js";
import { MAT_OQL_SPEC, normalizeOqlInput } from "./oqlSpec.js";
import { ensureAllowedHeapPath } from "./pathGuard.js";
import { runCommand, tail } from "./runner.js";
import { prepareHeapForExecution } from "./staging.js";

export interface ParseReportInput {
  heap_path: string;
  report_id: string;
  options?: Record<string, string | number | boolean>;
  xmx_mb?: number;
  timeout_sec?: number;
}

export interface OqlQueryInput {
  heap_path: string;
  oql: string;
  format?: "txt" | "html" | "csv";
  unzip?: boolean;
  limit?: number;
  xmx_mb?: number;
  timeout_sec?: number;
}

export interface HealthcheckInput {
  mat_home?: string;
  mat_launcher?: string;
  java_path?: string;
}

export interface IndexStatusInput {
  heap_path: string;
}

export interface MatRunCommandInput {
  heap_path: string;
  command_name: string;
  command_args?: string;
  format?: "txt" | "html" | "csv";
  unzip?: boolean;
  limit?: number;
  xmx_mb?: number;
  timeout_sec?: number;
}

export interface MatServiceDeps {
  runCommand: (command: RunCommand) => Promise<RunResult>;
}

const PATH_OPTION_KEYS = new Set(["baseline", "snapshot2"]);

export class MatService {
  private readonly deps: MatServiceDeps;

  constructor(private readonly config: CliConfig, deps?: Partial<MatServiceDeps>) {
    this.deps = {
      runCommand,
      ...deps
    };
  }

  async healthcheck(input: HealthcheckInput): Promise<MatHealthcheckSuccess | MatErrorResponse> {
    try {
      const launcher = resolveMatLauncher({
        matLauncher: input.mat_launcher ?? this.config.matLauncher,
        matHome: input.mat_home ?? this.config.matHome
      });
      const javaVersion = detectJavaVersion(input.java_path ?? this.config.javaPath);

      return {
        status: "ok",
        ok: true,
        mat_launcher: launcher,
        java_version: javaVersion,
        notes: [
          `allowed_roots=${this.config.allowedRoots.length}`,
          `debug_logging=${this.config.debug ? "enabled" : "disabled"}`
        ]
      };
    } catch (error) {
      return this.normalizeError(error, "MAT_NOT_FOUND");
    }
  }

  async parseReport(input: ParseReportInput): Promise<MatParseReportSuccess | MatErrorResponse> {
    try {
      const reportId = this.validateReportId(input.report_id);
      const heapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      const preparedHeap = prepareHeapForExecution(heapPath, this.config.matDataDir);
      const launcher = this.resolveLauncher();
      const options = this.prepareExecutionOptions(this.sanitizeOptions(this.normalizeReportOptions(reportId, input.options ?? {})));
      const startedAtMs = Date.now();
      const command = buildParseReportCommand(
        {
          javaPath: this.config.javaPath,
          launcherPath: launcher,
          heapPath: preparedHeap.executionHeapPath,
          configDir: this.config.matConfigDir,
          dataDir: this.config.matDataDir,
          xmxMb: this.validateBoundedInt(input.xmx_mb, this.config.defaultXmxMb, 256, 262144, "xmx_mb"),
          timeoutSec: this.validateBoundedInt(input.timeout_sec, this.config.defaultTimeoutSec, 5, 172800, "timeout_sec")
        },
        reportId,
        options
      );

      const run = await this.executeMat("report", command);
      if (run.exitCode !== 0) {
        throw classifyRunFailure(run, this.config.stdioTailChars);
      }

      const artifacts = resolveReportArtifacts(preparedHeap.executionHeapPath, startedAtMs);
      return {
        status: "ok",
        exit_code: run.exitCode ?? 0,
        report_dir: artifacts.reportDir,
        report_zip: artifacts.reportZip,
        generated_files: artifacts.generatedFiles,
        stdout_tail: tail(run.stdout, this.config.stdioTailChars),
        stderr_tail: tail(run.stderr, this.config.stdioTailChars)
      };
    } catch (error) {
      return this.normalizeError(error, "MAT_PARSE_FAILED");
    }
  }

  async oqlQuery(input: OqlQueryInput): Promise<MatOqlQuerySuccess | MatErrorResponse> {
    try {
      const heapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      const preparedHeap = prepareHeapForExecution(heapPath, this.config.matDataDir);
      const launcher = this.resolveLauncher();
      const normalizedOql = normalizeOqlInput(input.oql);
      const oqlBytes = Buffer.byteLength(normalizedOql, "utf8");
      if (oqlBytes > this.config.oqlMaxBytes) {
        throw new MatCliError({
          category: "INVALID_QUERY",
          message: `OQL exceeds max size (${oqlBytes} > ${this.config.oqlMaxBytes} bytes).`,
          hint: "Reduce the query size or increase MAT_OQL_MAX_BYTES."
        });
      }

      const startedAtMs = Date.now();
      const command = buildOqlCommand(
        {
          javaPath: this.config.javaPath,
          launcherPath: launcher,
          heapPath: preparedHeap.executionHeapPath,
          configDir: this.config.matConfigDir,
          dataDir: this.config.matDataDir,
          xmxMb: this.validateBoundedInt(input.xmx_mb, this.config.defaultXmxMb, 256, 262144, "xmx_mb"),
          timeoutSec: this.validateBoundedInt(input.timeout_sec, this.config.defaultTimeoutSec, 5, 172800, "timeout_sec")
        },
        {
          oql: normalizedOql,
          format: input.format ?? "txt",
          unzip: input.unzip ?? true,
          limit: input.limit === undefined ? undefined : this.validateBoundedInt(input.limit, input.limit, 1, 10_000_000, "limit")
        }
      );

      const run = await this.executeMat("query", command);
      if (run.exitCode !== 0) {
        throw classifyRunFailure(run, this.config.stdioTailChars);
      }

      const artifacts = resolveQueryArtifacts(preparedHeap.executionHeapPath, startedAtMs);
      return {
        status: "ok",
        exit_code: run.exitCode ?? 0,
        query_dir: artifacts.queryDir,
        query_zip: artifacts.queryZip,
        result_txt: artifacts.resultTxt,
        result_preview: artifacts.resultTxt ? readResultPreview(artifacts.resultTxt, this.config.resultPreviewLines) : [],
        generated_files: artifacts.generatedFiles,
        stdout_tail: tail(run.stdout, this.config.stdioTailChars),
        stderr_tail: tail(run.stderr, this.config.stdioTailChars)
      };
    } catch (error) {
      return this.normalizeError(error, "MAT_PARSE_FAILED");
    }
  }

  async runCommand(input: MatRunCommandInput): Promise<MatRunCommandSuccess | MatErrorResponse> {
    try {
      const commandName = this.validateCommandName(input.command_name);
      const heapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      const preparedHeap = prepareHeapForExecution(heapPath, this.config.matDataDir);
      const launcher = this.resolveLauncher();

      if (input.command_args !== undefined) {
        const argsBytes = Buffer.byteLength(input.command_args, "utf8");
        if (argsBytes > this.config.oqlMaxBytes) {
          throw new MatCliError({
            category: "INVALID_QUERY",
            message: `command_args exceeds max size (${argsBytes} > ${this.config.oqlMaxBytes} bytes).`,
            hint: "Reduce command_args size or increase MAT_OQL_MAX_BYTES."
          });
        }
      }

      const startedAtMs = Date.now();
      const command = buildGenericCommand(
        {
          javaPath: this.config.javaPath,
          launcherPath: launcher,
          heapPath: preparedHeap.executionHeapPath,
          configDir: this.config.matConfigDir,
          dataDir: this.config.matDataDir,
          xmxMb: this.validateBoundedInt(input.xmx_mb, this.config.defaultXmxMb, 256, 262144, "xmx_mb"),
          timeoutSec: this.validateBoundedInt(input.timeout_sec, this.config.defaultTimeoutSec, 5, 172800, "timeout_sec")
        },
        {
          commandName,
          commandArgs: input.command_args,
          format: input.format ?? "txt",
          unzip: input.unzip ?? true,
          limit: input.limit === undefined ? undefined : this.validateBoundedInt(input.limit, input.limit, 1, 10_000_000, "limit")
        }
      );

      const run = await this.executeMat("run", command);
      if (run.exitCode !== 0) {
        throw classifyRunFailure(run, this.config.stdioTailChars);
      }

      const artifacts = resolveQueryArtifacts(preparedHeap.executionHeapPath, startedAtMs);
      return {
        status: "ok",
        exit_code: run.exitCode ?? 0,
        command_name: commandName,
        query_dir: artifacts.queryDir,
        query_zip: artifacts.queryZip,
        result_txt: artifacts.resultTxt,
        result_preview: artifacts.resultTxt ? readResultPreview(artifacts.resultTxt, this.config.resultPreviewLines) : [],
        generated_files: artifacts.generatedFiles,
        stdout_tail: tail(run.stdout, this.config.stdioTailChars),
        stderr_tail: tail(run.stderr, this.config.stdioTailChars)
      };
    } catch (error) {
      return this.normalizeError(error, "MAT_PARSE_FAILED");
    }
  }

  indexStatus(input: IndexStatusInput): MatIndexStatusSuccess | MatErrorResponse {
    try {
      const heapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      const artifacts = resolveIndexArtifacts(heapPath);
      return {
        status: "ok",
        index_present: artifacts.indexPresent,
        index_files: artifacts.indexFiles,
        threads_file: artifacts.threadsFile,
        last_modified: artifacts.lastModified
      };
    } catch (error) {
      return this.normalizeError(error, "HEAP_NOT_FOUND");
    }
  }

  oqlSpec(): MatOqlSpecSuccess {
    return {
      status: "ok",
      ...MAT_OQL_SPEC
    };
  }

  private resolveLauncher(): string {
    return resolveMatLauncher({
      matLauncher: this.config.matLauncher,
      matHome: this.config.matHome
    });
  }

  private validateReportId(reportId: string): string {
    if ((ALLOWED_REPORT_IDS as readonly string[]).includes(reportId)) {
      return reportId;
    }
    throw new MatCliError({
      category: "MAT_PARSE_FAILED",
      message: `Unsupported report_id: ${reportId}`,
      hint: `Use one of: ${ALLOWED_REPORT_IDS.join(", ")}`
    });
  }

  private validateCommandName(commandName: string): string {
    const trimmed = commandName.trim();
    if ((ALLOWED_COMMANDS as readonly string[]).includes(trimmed)) {
      return trimmed;
    }
    throw new MatCliError({
      category: "MAT_PARSE_FAILED",
      message: `Unsupported command_name: ${trimmed}`,
      hint: `Use one of: ${(ALLOWED_COMMANDS as readonly string[]).join(", ")}`
    });
  }

  private sanitizeOptions(options: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
    const sanitized: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(options)) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
        throw new MatCliError({
          category: "MAT_PARSE_FAILED",
          message: `Invalid option key: ${key}`,
          hint: "Option keys must contain only letters, numbers, underscore, dot, or dash."
        });
      }

      if (PATH_OPTION_KEYS.has(key)) {
        if (typeof value !== "string") {
          throw new MatCliError({
            category: "MAT_PARSE_FAILED",
            message: `Option ${key} must be a file path string.`,
            hint: "Provide an absolute or working-directory-relative path for compare/baseline options."
          });
        }
        sanitized[key] = ensureAllowedHeapPath(value, this.config.allowedRoots);
        continue;
      }

      sanitized[key] = value;
    }
    return sanitized;
  }

  private normalizeReportOptions(
    reportId: string,
    options: Record<string, string | number | boolean>
  ): Record<string, string | number | boolean> {
    if (reportId !== "org.eclipse.mat.api:compare") {
      return options;
    }

    if (!("baseline" in options) || "snapshot2" in options) {
      return options;
    }

    return {
      ...options,
      snapshot2: options.baseline
    };
  }

  private prepareExecutionOptions(options: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
    const prepared: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(options)) {
      if (PATH_OPTION_KEYS.has(key) && typeof value === "string") {
        prepared[key] = prepareHeapForExecution(value, this.config.matDataDir).executionHeapPath;
        continue;
      }
      prepared[key] = value;
    }
    return prepared;
  }

  private validateBoundedInt(value: number | undefined, fallback: number, min: number, max: number, field: string): number {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
      throw new MatCliError({
        category: "MAT_PARSE_FAILED",
        message: `${field} must be an integer between ${min} and ${max}.`,
        hint: `Set ${field} within the valid range.`
      });
    }
    return resolved;
  }

  private async executeMat(commandName: string, command: RunCommand): Promise<RunResult> {
    try {
      const run = await this.deps.runCommand(command);
      persistDebugLog({
        enabled: this.config.debug,
        logDir: this.config.debugLogDir,
        commandName,
        run
      });
      return run;
    } catch (error) {
      throw classifySpawnError(error);
    }
  }

  private normalizeError(
    error: unknown,
    fallbackCategory: "MAT_NOT_FOUND" | "MAT_PARSE_FAILED" | "HEAP_NOT_FOUND"
  ): MatErrorResponse {
    if (error instanceof MatCliError) {
      return error.toResponse();
    }

    const message = error instanceof Error ? error.message : String(error);
    return new MatCliError({
      category: fallbackCategory,
      message,
      hint: "Unexpected runtime error. Check debug logs for details."
    }).toResponse();
  }
}

function readResultPreview(filePath: string, lineLimit: number): string[] {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return [];
  }

  try {
    const lines: string[] = [];
    const buffer = Buffer.alloc(8192);
    let remainder = "";
    let bytesRead: number;

    while ((bytesRead = fs.readSync(fd, buffer)) > 0) {
      const chunk = remainder + buffer.toString("utf8", 0, bytesRead);
      const parts = chunk.split(/\r?\n/);
      remainder = parts.pop() ?? "";

      for (const part of parts) {
        if (part.length > 0) {
          lines.push(part);
          if (lines.length >= lineLimit) {
            return lines;
          }
        }
      }
    }

    if (remainder.length > 0 && lines.length < lineLimit) {
      lines.push(remainder);
    }
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}
