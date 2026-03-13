import fs from "node:fs";
import path from "node:path";
import { Command, CommanderError } from "commander";
import { findCliCommand, getCatalog, CLI_COMMANDS } from "../catalog.js";
import { loadConfig } from "../config.js";
import { AnalysisService } from "../core/analysisService.js";
import { MatService, type MatServiceDeps } from "../core/service.js";
import { createOverflowStore, formatHumanResponse, formatJsonResponse, renderCommandHelp, renderTopLevelHelp, renderUsageError, type OverflowStore } from "./format.js";
import { MatCliError, type CommandResponse } from "../types.js";

interface Writer {
  write(text: string): void;
}

export interface CliIo {
  stdout: Writer;
  stderr: Writer;
}

export interface CliRunOptions {
  env?: NodeJS.ProcessEnv;
  io?: CliIo;
  matServiceDeps?: Partial<MatServiceDeps>;
  overflowStore?: OverflowStore;
  now?: () => number;
}

interface SharedRuntimeOptions {
  allowedRoot?: string[];
  matHome?: string;
  matLauncher?: string;
  javaPath?: string;
  xmxMb?: number;
  timeoutSec?: number;
  previewLines?: number;
  stdioTailChars?: number;
  json?: boolean;
}

interface ReportOptions extends SharedRuntimeOptions {
  heap: string;
  option?: string[];
}

interface QueryOptions extends SharedRuntimeOptions {
  heap: string;
  query?: string;
  queryFile?: string;
  format?: "txt" | "html" | "csv";
  unzip?: boolean;
  limit?: number;
}

interface RunOptions extends SharedRuntimeOptions {
  heap: string;
  args?: string;
  format?: "txt" | "html" | "csv";
  unzip?: boolean;
  limit?: number;
}

interface DoctorOptions extends SharedRuntimeOptions {
  heap?: string;
}

interface CatalogOptions {
  json?: boolean;
}

interface TriageOptions extends SharedRuntimeOptions {
  heap: string;
  top?: number;
}

interface InspectObjectOptions extends SharedRuntimeOptions {
  heap: string;
  objectId?: string;
}

interface CompareOptions extends SharedRuntimeOptions {
  heap: string;
  baseline?: string;
  top?: number;
}

interface ShowArtifactOptions {
  entry?: string;
  previewLines?: number;
  json?: boolean;
}

const DEFAULT_IO: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr
};

export async function runCli(argv: string[], options: CliRunOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const io = options.io ?? DEFAULT_IO;
  const overflowStore = options.overflowStore ?? createOverflowStore();
  const now = options.now ?? Date.now;
  const startedAt = now();

  if (argv.length === 0) {
    io.stdout.write(`${renderTopLevelHelp(CLI_COMMANDS)}\n`);
    return 0;
  }

  if (isTopLevelJsonCatalog(argv)) {
    const response = getCatalog("all");
    io.stdout.write(`${formatJsonResponse("catalog", response, 0, 0)}\n`);
    return 0;
  }

  if (isHelpRequest(argv)) {
    const helpTarget = resolveHelpTarget(argv);
    const helpText = helpTarget ? renderCommandHelp(helpTarget) : renderTopLevelHelp(CLI_COMMANDS);
    io.stdout.write(`${helpText}\n`);
    return 0;
  }

  let finalExitCode = 0;
  const program = buildProgram(env, io, overflowStore, options.matServiceDeps, now, (exitCode) => {
    finalExitCode = exitCode;
  });
  try {
    await program.parseAsync(argv, { from: "user" });
    return finalExitCode;
  } catch (error) {
    const helpText = buildFailureHelpText(argv);
    if (error instanceof CommanderError) {
      if (error.code === "commander.help") {
        return 0;
      }
      return emitFailure(io, overflowStore, parseCommanderError(error), now() - startedAt, wantsJson(argv), "mat", helpText);
    }
    const response = normalizeError(error);
    return emitFailure(io, overflowStore, response, now() - startedAt, wantsJson(argv), "mat", helpText);
  }
}

function buildProgram(
  env: NodeJS.ProcessEnv,
  io: CliIo,
  overflowStore: OverflowStore,
  matServiceDeps: Partial<MatServiceDeps> | undefined,
  now: () => number,
  onExitCode: (exitCode: number) => void
): Command {
  const program = new Command();
  program
    .name("mat")
    .description("Agent-friendly Eclipse MAT CLI")
    .helpOption(false)
    .allowExcessArguments(false)
    .showSuggestionAfterError(false)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: () => undefined,
      outputError: () => undefined
    });

  const doctor = program.command("doctor").description("Validate MAT launcher and Java runtime.").helpOption(false);
  addSharedOptions(doctor, false);
  doctor.action(async (opts: DoctorOptions) => {
    const startedAt = now();
    const service = createService(env, opts, matServiceDeps);
    const response = await service.healthcheck({
      mat_home: opts.matHome,
      mat_launcher: opts.matLauncher,
      java_path: opts.javaPath
    });
    onExitCode(emitResult(io, overflowStore, "doctor", response, now() - startedAt, opts.json ?? false));
  });

  const report = program.command("report").description("Run a predefined MAT report.").helpOption(false);
  report.argument("<reportId>", "MAT report identifier");
  addSharedOptions(report, true);
  report.option("--heap <path>", "Heap dump path");
  report.option("--option <key=value>", "Additional MAT report option", collectOption, []);
  report.action(async (reportId: string, opts: ReportOptions) => {
    const startedAt = now();
    assertRequiredOption(opts.heap, "report requires --heap <path>.");
    const service = createService(env, opts, matServiceDeps);
    const response = await service.parseReport({
      heap_path: opts.heap,
      report_id: reportId,
      options: parseKeyValueOptions(opts.option ?? []),
      xmx_mb: opts.xmxMb,
      timeout_sec: opts.timeoutSec
    });
    onExitCode(emitResult(io, overflowStore, "report", response, now() - startedAt, opts.json ?? false));
  });

  const triage = program.command("triage").description("Run first-pass heap triage and summarize the main findings.").helpOption(false);
  addSharedOptions(triage, true);
  triage.option("--heap <path>", "Heap dump path");
  triage.option("--top <n>", "Maximum findings to keep per section", parseIntOption);
  triage.action(async (opts: TriageOptions) => {
    const startedAt = now();
    assertRequiredOption(opts.heap, "triage requires --heap <path>.");
    const service = createAnalysisService(env, opts, matServiceDeps);
    const response = await service.triage({
      heap_path: opts.heap,
      top: opts.top,
      xmx_mb: opts.xmxMb,
      timeout_sec: opts.timeoutSec
    });
    onExitCode(emitResult(io, overflowStore, "triage", response, now() - startedAt, opts.json ?? false));
  });

  const inspectObject = program.command("inspect-object").description("Inspect one object through GC-root and dominator paths.").helpOption(false);
  addSharedOptions(inspectObject, true);
  inspectObject.option("--heap <path>", "Heap dump path");
  inspectObject.option("--object-id <id>", "MAT object id, for example 0xc2300098");
  inspectObject.action(async (opts: InspectObjectOptions) => {
    const startedAt = now();
    assertRequiredOption(opts.heap, "inspect-object requires --heap <path>.");
    assertRequiredOption(opts.objectId, "inspect-object requires --object-id <id>.");
    const service = createAnalysisService(env, opts, matServiceDeps);
    const response = await service.inspectObject({
      heap_path: opts.heap,
      object_id: opts.objectId,
      xmx_mb: opts.xmxMb,
      timeout_sec: opts.timeoutSec
    });
    onExitCode(emitResult(io, overflowStore, "inspect-object", response, now() - startedAt, opts.json ?? false));
  });

  const compare = program.command("compare").description("Compare two heaps and summarize histogram deltas.").helpOption(false);
  addSharedOptions(compare, true);
  compare.option("--heap <path>", "New heap dump path");
  compare.option("--baseline <path>", "Baseline heap dump path");
  compare.option("--top <n>", "Maximum findings to keep", parseIntOption);
  compare.action(async (opts: CompareOptions) => {
    const startedAt = now();
    assertRequiredOption(opts.heap, "compare requires --heap <path>.");
    assertRequiredOption(opts.baseline, "compare requires --baseline <path>.");
    const service = createAnalysisService(env, opts, matServiceDeps, [
      path.dirname(opts.heap),
      path.dirname(opts.baseline)
    ]);
    const response = await service.compare({
      heap_path: opts.heap,
      baseline_heap_path: opts.baseline,
      top: opts.top,
      xmx_mb: opts.xmxMb,
      timeout_sec: opts.timeoutSec
    });
    onExitCode(emitResult(io, overflowStore, "compare", response, now() - startedAt, opts.json ?? false));
  });

  const query = program.command("query").description("Execute a single MAT OQL query.").helpOption(false);
  addSharedOptions(query, true);
  query.option("--heap <path>", "Heap dump path");
  query.option("--query <oql>", "Inline OQL text");
  query.option("--query-file <path>", "Path to a file containing OQL");
  query.option("--format <format>", "MAT output format");
  query.option("--no-unzip", "Do not unpack MAT query archives");
  query.option("--limit <n>", "Optional result limit", parseIntOption);
  query.action(async (opts: QueryOptions) => {
    const startedAt = now();
    assertRequiredOption(opts.heap, "query requires --heap <path>.");
    const oql = resolveQueryText(opts.query, opts.queryFile);
    const service = createService(env, opts, matServiceDeps);
    const response = await service.oqlQuery({
      heap_path: opts.heap,
      oql,
      format: opts.format,
      unzip: opts.unzip,
      limit: opts.limit,
      xmx_mb: opts.xmxMb,
      timeout_sec: opts.timeoutSec
    });
    onExitCode(emitResult(io, overflowStore, "query", response, now() - startedAt, opts.json ?? false));
  });

  const run = program.command("run").description("Execute a named MAT analysis command.").helpOption(false);
  run.argument("<commandName>", "MAT command name");
  addSharedOptions(run, true);
  run.option("--heap <path>", "Heap dump path");
  run.option("--args <text>", "Command arguments");
  run.option("--format <format>", "MAT output format");
  run.option("--no-unzip", "Do not unpack MAT query archives");
  run.option("--limit <n>", "Optional result limit", parseIntOption);
  run.action(async (commandName: string, opts: RunOptions) => {
    const startedAt = now();
    assertRequiredOption(opts.heap, "run requires --heap <path>.");
    const service = createService(env, opts, matServiceDeps);
    const response = await service.runCommand({
      heap_path: opts.heap,
      command_name: commandName,
      command_args: opts.args,
      format: opts.format,
      unzip: opts.unzip,
      limit: opts.limit,
      xmx_mb: opts.xmxMb,
      timeout_sec: opts.timeoutSec
    });
    onExitCode(emitResult(io, overflowStore, "run", response, now() - startedAt, opts.json ?? false));
  });

  const index = program.command("index").description("Check index artifacts for a heap dump.").helpOption(false);
  addSharedOptions(index, true);
  index.option("--heap <path>", "Heap dump path");
  index.action((opts: SharedRuntimeOptions & { heap: string }) => {
    const startedAt = now();
    assertRequiredOption(opts.heap, "index requires --heap <path>.");
    const service = createService(env, opts, matServiceDeps);
    const response = service.indexStatus({
      heap_path: opts.heap
    });
    onExitCode(emitResult(io, overflowStore, "index", response, now() - startedAt, opts.json ?? false));
  });

  const showArtifact = program.command("show-artifact").description("Preview a MAT artifact directory, zip, or text output.").helpOption(false);
  showArtifact.argument("<artifactPath>", "Artifact path");
  showArtifact.option("--entry <path>", "Zip or directory entry to preview");
  showArtifact.option("--preview-lines <n>", "Result preview line limit", parseIntOption);
  showArtifact.option("--json", "Emit JSON output");
  showArtifact.action((artifactPath: string, opts: ShowArtifactOptions) => {
    const startedAt = now();
    const service = createAnalysisService(env, { previewLines: opts.previewLines }, matServiceDeps);
    const response = service.showArtifact({
      artifact_path: artifactPath,
      entry: opts.entry
    });
    onExitCode(emitResult(io, overflowStore, "show-artifact", response, now() - startedAt, opts.json ?? false));
  });

  const catalog = program.command("catalog").description("Show machine-readable command/report catalog.").helpOption(false);
  catalog.argument("[section]", "all | commands | reports | oql | errors", "all");
  catalog.option("--json", "Emit JSON output");
  catalog.action((section: string, opts: CatalogOptions) => {
    const startedAt = now();
    const normalizedSection = normalizeCatalogSection(section);
    const response = getCatalog(normalizedSection);
    onExitCode(emitResult(io, overflowStore, "catalog", response, now() - startedAt, opts.json ?? false));
  });

  return program;
}

function addSharedOptions(command: Command, includeAllowedRoot: boolean): void {
  if (includeAllowedRoot) {
    command.option("--allowed-root <dir>", "Allowed heap root directory", collectOption, []);
  }
  command.option("--mat-home <dir>", "MAT installation root");
  command.option("--mat-launcher <jar>", "Explicit MAT launcher jar");
  command.option("--java-path <bin>", "Java executable path");
  command.option("--xmx-mb <mb>", "MAT JVM heap size", parseIntOption);
  command.option("--timeout-sec <sec>", "MAT timeout in seconds", parseIntOption);
  command.option("--preview-lines <n>", "Result preview line limit", parseIntOption);
  command.option("--stdio-tail-chars <n>", "Captured stdout/stderr tail size", parseIntOption);
  command.option("--json", "Emit JSON output");
}

function createService(
  env: NodeJS.ProcessEnv,
  opts: SharedRuntimeOptions,
  matServiceDeps: Partial<MatServiceDeps> | undefined,
  extraAllowedRoots: string[] = []
): MatService {
  const allowedRoots = mergeAllowedRoots(opts.allowedRoot, extraAllowedRoots);
  const config = loadConfig(env, {
    allowedRoots,
    heapPath: resolveHeapPath(opts),
    matHome: opts.matHome,
    matLauncher: opts.matLauncher,
    javaPath: opts.javaPath,
    xmxMb: opts.xmxMb,
    timeoutSec: opts.timeoutSec,
    previewLines: opts.previewLines,
    stdioTailChars: opts.stdioTailChars
  });
  return new MatService(config, matServiceDeps);
}

function createAnalysisService(
  env: NodeJS.ProcessEnv,
  opts: SharedRuntimeOptions,
  matServiceDeps: Partial<MatServiceDeps> | undefined,
  extraAllowedRoots: string[] = []
): AnalysisService {
  const allowedRoots = mergeAllowedRoots(opts.allowedRoot, extraAllowedRoots);
  const config = loadConfig(env, {
    allowedRoots,
    heapPath: resolveHeapPath(opts),
    matHome: opts.matHome,
    matLauncher: opts.matLauncher,
    javaPath: opts.javaPath,
    xmxMb: opts.xmxMb,
    timeoutSec: opts.timeoutSec,
    previewLines: opts.previewLines,
    stdioTailChars: opts.stdioTailChars
  });
  return new AnalysisService(config, matServiceDeps);
}

function resolveHeapPath(opts: SharedRuntimeOptions): string | undefined {
  if (!("heap" in opts)) {
    return undefined;
  }

  const heap = (opts as SharedRuntimeOptions & { heap?: string }).heap;
  return typeof heap === "string" ? heap : undefined;
}

function emitResult(
  io: CliIo,
  overflowStore: OverflowStore,
  command: string,
  response: CommandResponse,
  durationMs: number,
  json: boolean
): number {
  const cliExitCode = response.status === "error" ? mapCliExitCode(response.category) : 0;
  const text = json
    ? `${formatJsonResponse(command, response, durationMs, cliExitCode)}\n`
    : formatHumanResponse(command, response, durationMs, cliExitCode, overflowStore);

  if (!json && response.status === "error") {
    io.stderr.write(text);
    return cliExitCode;
  }
  io.stdout.write(text);
  return cliExitCode;
}

function emitFailure(
  io: CliIo,
  overflowStore: OverflowStore,
  response: CommandResponse,
  durationMs: number,
  json: boolean,
  command: string,
  helpText: string
): number {
  const cliExitCode = response.status === "error" ? mapCliExitCode(response.category) : 0;
  const text = json
    ? `${formatJsonResponse(command, response, durationMs, cliExitCode)}\n`
    : response.status === "error" && response.category === "CLI_USAGE"
      ? `${renderUsageError(response.message, helpText)}\n[exit:${cliExitCode} | ${durationMs}ms]\n`
      : formatHumanResponse(command, response, durationMs, cliExitCode, overflowStore);

  if (!json && response.status === "error") {
    io.stderr.write(text);
  } else {
    io.stdout.write(text);
  }
  return cliExitCode;
}

function mapCliExitCode(category: string): number {
  switch (category) {
    case "CLI_USAGE":
      return 2;
    case "MAT_NOT_FOUND":
      return 3;
    case "HEAP_NOT_FOUND":
    case "WRITE_PERMISSION_DENIED":
      return 4;
    case "MAT_TIMEOUT":
      return 124;
    case "INVALID_QUERY":
    case "MAT_PARSE_FAILED":
    default:
      return 5;
  }
}

function parseCommanderError(error: CommanderError): CommandResponse {
  return new MatCliError({
    category: "CLI_USAGE",
    message: error.message,
    hint: "Check the usage shown below and retry."
  }).toResponse();
}

function normalizeError(error: unknown): CommandResponse {
  if (error instanceof MatCliError) {
    return error.toResponse();
  }
  return new MatCliError({
    category: "CLI_USAGE",
    message: error instanceof Error ? error.message : String(error),
    hint: "Check the command usage and retry."
  }).toResponse();
}

function resolveQueryText(query: string | undefined, queryFile: string | undefined): string {
  if (query && queryFile) {
    throw new MatCliError({
      category: "CLI_USAGE",
      message: "Use either --query or --query-file, not both.",
      hint: "Provide a single OQL source."
    });
  }
  if (!query && !queryFile) {
    throw new MatCliError({
      category: "CLI_USAGE",
      message: "query requires --query <oql> or --query-file <path>.",
      hint: "Provide inline OQL or point to a text file."
    });
  }
  if (query) {
    return query;
  }

  const filePath = queryFile!;
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    throw new MatCliError({
      category: "CLI_USAGE",
      message: `Query file is not readable: ${filePath}`,
      hint: "Point --query-file at a readable UTF-8 text file."
    });
  }
}

function assertRequiredOption(value: string | undefined, message: string): asserts value is string {
  if (!value || value.trim().length === 0) {
    throw new MatCliError({
      category: "CLI_USAGE",
      message,
      hint: "Use --help for command-specific usage."
    });
  }
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseIntOption(value: string): number {
  return Number.parseInt(value, 10);
}

function parseScalarValue(value: string): string | number | boolean {
  const normalized = value.trim();
  if (/^(true|false)$/i.test(normalized)) {
    return normalized.toLowerCase() === "true";
  }
  if (/^-?\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  return value;
}

function parseKeyValueOptions(items: string[]): Record<string, string | number | boolean> {
  const options: Record<string, string | number | boolean> = {};
  for (const item of items) {
    const separator = item.indexOf("=");
    if (separator <= 0) {
      throw new MatCliError({
        category: "CLI_USAGE",
        message: `Invalid --option value: ${item}`,
        hint: "Use repeated --option key=value entries."
      });
    }
    const key = item.slice(0, separator);
    const value = item.slice(separator + 1);
    options[key] = parseScalarValue(value);
  }
  return options;
}

function normalizeCatalogSection(section: string) {
  if (section === "all" || section === "commands" || section === "reports" || section === "oql" || section === "errors") {
    return section;
  }
  throw new MatCliError({
    category: "CLI_USAGE",
    message: `Unknown catalog section: ${section}`,
    hint: "Use one of: all, commands, reports, oql, errors."
  });
}

function wantsJson(argv: string[]): boolean {
  return argv.includes("--json");
}

function isTopLevelJsonCatalog(argv: string[]): boolean {
  return argv.length === 1 && argv[0] === "--json";
}

function isHelpRequest(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function resolveHelpTarget(argv: string[]) {
  for (const token of argv) {
    if (token.startsWith("-")) {
      continue;
    }
    const command = findCliCommand(token);
    if (command) {
      return command;
    }
    break;
  }
  return undefined;
}

function buildFailureHelpText(argv: string[]): string {
  const target = resolveHelpTarget(argv);
  return target ? renderCommandHelp(target) : renderTopLevelHelp(CLI_COMMANDS);
}

function mergeAllowedRoots(existing: string[] | undefined, extraAllowedRoots: string[]): string[] | undefined {
  const merged = [...(existing ?? []), ...extraAllowedRoots].filter((item) => item.trim().length > 0);
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}
