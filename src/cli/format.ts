import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  MatArtifactPreviewSuccess,
  MatCompareSuccess,
  CatalogCommandEntry,
  CatalogSuccess,
  CommandResponse,
  MatErrorResponse,
  MatHealthcheckSuccess,
  MatIndexStatusSuccess,
  MatInspectObjectSuccess,
  MatOqlQuerySuccess,
  MatParseReportSuccess,
  MatRunCommandSuccess,
  MatTriageSuccess
} from "../types.js";

const MAX_OUTPUT_LINES = 200;
const MAX_OUTPUT_BYTES = 50 * 1024;

export interface OverflowStore {
  write(text: string): string;
}

export function createOverflowStore(baseDir = path.join(os.tmpdir(), "mat-cli-output")): OverflowStore {
  return {
    write(text: string): string {
      fs.mkdirSync(baseDir, { recursive: true });
      const filePath = path.join(baseDir, `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.txt`);
      fs.writeFileSync(filePath, text, "utf8");
      return filePath;
    }
  };
}

export function formatJsonResponse(command: string, response: CommandResponse, durationMs: number, cliExitCode: number): string {
  return JSON.stringify(
    {
      command,
      duration_ms: durationMs,
      cli_exit_code: cliExitCode,
      ...response
    },
    null,
    2
  );
}

export function formatHumanResponse(
  command: string,
  response: CommandResponse,
  durationMs: number,
  cliExitCode: number,
  overflowStore: OverflowStore
): string {
  const body = response.status === "error" ? renderError(response) : renderSuccess(command, response);
  const footer = formatFooter(cliExitCode, durationMs);
  const withOverflow = applyOverflow(body, footer, overflowStore);
  return `${withOverflow}\n`;
}

export function renderTopLevelHelp(commands: CatalogCommandEntry[]): string {
  const lines = [
    "mat - Agent-friendly Eclipse MAT CLI",
    "",
    "Usage:",
    "  mat <command> [options]",
    "",
    "Commands:"
  ];

  for (const command of commands) {
    lines.push(`  ${command.name.padEnd(8)} ${command.summary}`);
  }

  lines.push(
    "",
    "Discovery:",
    "  mat <command> --help",
    "  mat catalog --json",
    "",
    "Shared runtime options:",
    "  --allowed-root <dir>     Heap root allowlist (repeatable, defaults to --heap parent)",
    "  --mat-home <dir>         MAT installation root (auto-detected on macOS when installed)",
    "  --mat-launcher <jar>     Explicit Equinox launcher jar",
    "  --java-path <bin>        Java executable to invoke MAT",
    "  --xmx-mb <mb>            MAT JVM heap size",
    "  --timeout-sec <sec>      MAT execution timeout",
    "  --preview-lines <n>      Result preview lines for query/run",
    "  --stdio-tail-chars <n>   Tail size for stdout/stderr capture",
    "  --json                   Emit stable machine-readable JSON"
  );

  return lines.join("\n");
}

export function renderCommandHelp(command: CatalogCommandEntry): string {
  const lines = [
    `mat ${command.name} - ${command.summary}`,
    "",
    "Usage:",
    `  ${command.usage}`
  ];

  if (command.examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of command.examples) {
      lines.push(`  ${example}`);
    }
  }

  if (command.related.length > 0) {
    lines.push("", "Related:");
    for (const related of command.related) {
      lines.push(`  mat ${related}`);
    }
  }

  lines.push(
    "",
    "Shared runtime options:",
    "  --mat-home, --mat-launcher, --java-path, --allowed-root (defaults to --heap parent), --xmx-mb, --timeout-sec, --preview-lines, --stdio-tail-chars, --json"
  );

  return lines.join("\n");
}

export function renderUsageError(message: string, helpText: string): string {
  return [
    `Error: ${message}`,
    "Hint: Use --help for the command-specific usage.",
    "",
    helpText
  ].join("\n");
}

function renderSuccess(command: string, response: Exclude<CommandResponse, MatErrorResponse>): string {
  switch (command) {
    case "doctor": {
      const data = response as MatHealthcheckSuccess;
      return [
        "MAT runtime is available.",
        `Launcher: ${data.mat_launcher}`,
        `Java: ${data.java_version}`,
        ...data.notes.map((note) => `Note: ${note}`)
      ].join("\n");
    }
    case "report": {
      const data = response as MatParseReportSuccess;
      return [
        "MAT report completed.",
        `Report directory: ${data.report_dir ?? "(not created)"}`,
        `Report archive: ${data.report_zip ?? "(not created)"}`,
        renderPathList("Generated files", data.generated_files),
        renderTail("stdout", data.stdout_tail),
        renderTail("stderr", data.stderr_tail)
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "triage": {
      const data = response as MatTriageSuccess;
      return [
        data.summary,
        renderFlatFindings("Hotspots", data.hotspots.map((item) => `${item.label} (${formatHeapBytes(item.retained_heap_bytes)} retained)`)),
        renderFlatFindings("Leak Suspects", data.suspects.map((item) => item.headline)),
        renderFlatFindings("Histogram", data.histogram.map((item) => `${item.label} (${formatHeapBytes(item.retained_heap_bytes)} retained)`)),
        renderFlatFindings("Next Steps", data.next_steps),
        renderWarnings(data.warnings),
        renderAnalysisArtifacts(data.artifacts)
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "inspect-object": {
      const data = response as MatInspectObjectSuccess;
      return [
        data.summary,
        renderFlatFindings("GC Root Path", data.gc_root_path.map((item) => item.label)),
        renderFlatFindings("Dominators", data.dominators.map((item) => `${item.label} (${formatHeapBytes(item.retained_heap_bytes)} retained)`)),
        renderFlatFindings("Retained Objects", data.retained_objects.map((item) => `${item.label} (${formatHeapBytes(item.shallow_heap_bytes)} shallow)`)),
        renderFlatFindings("Next Steps", data.next_steps),
        renderWarnings(data.warnings),
        renderAnalysisArtifacts(data.artifacts)
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "compare": {
      const data = response as MatCompareSuccess;
      return [
        data.summary,
        renderFlatFindings("Histogram Delta", data.histogram_delta.map((item) => `${item.label} (${formatDelta(item.object_count_delta)} objects)`)),
        renderFlatFindings("Next Steps", data.next_steps),
        renderWarnings(data.warnings),
        renderAnalysisArtifacts(data.artifacts)
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "query": {
      const data = response as MatOqlQuerySuccess;
      return [
        "MAT OQL query completed.",
        `Query directory: ${data.query_dir ?? "(not created)"}`,
        `Query archive: ${data.query_zip ?? "(not created)"}`,
        `Primary result: ${data.result_txt ?? "(not created)"}`,
        renderPathList("Generated files", data.generated_files),
        renderPreview("Result preview", data.result_preview),
        renderTail("stdout", data.stdout_tail),
        renderTail("stderr", data.stderr_tail)
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "show-artifact": {
      const data = response as MatArtifactPreviewSuccess;
      return [
        data.summary,
        data.selected_entry ? `Selected entry: ${data.selected_entry}` : "",
        renderPathList("Entries", data.entries),
        renderPreview("Preview", data.preview)
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "run": {
      const data = response as MatRunCommandSuccess;
      return [
        `MAT command completed: ${data.command_name}`,
        `Query directory: ${data.query_dir ?? "(not created)"}`,
        `Query archive: ${data.query_zip ?? "(not created)"}`,
        `Primary result: ${data.result_txt ?? "(not created)"}`,
        renderPathList("Generated files", data.generated_files),
        renderPreview("Result preview", data.result_preview),
        renderTail("stdout", data.stdout_tail),
        renderTail("stderr", data.stderr_tail)
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "index": {
      const data = response as MatIndexStatusSuccess;
      return [
        `Index present: ${data.index_present ? "yes" : "no"}`,
        `Last modified: ${data.last_modified ?? "(unknown)"}`,
        `Threads file: ${data.threads_file ?? "(none)"}`,
        renderPathList("Index files", data.index_files)
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "catalog":
      return renderCatalog(response);
    default:
      return JSON.stringify(response, null, 2);
  }
}

function renderCatalog(response: Exclude<CommandResponse, MatErrorResponse>): string {
  const data = response as CatalogSuccess;
  const lines: string[] = [];

  if (data.commands) {
    lines.push("Commands:");
    for (const command of data.commands) {
      lines.push(`  ${command.name} - ${command.summary}`);
    }
  }

  if (data.reports) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("Reports:");
    for (const report of data.reports) {
      lines.push(`  ${report.id} - ${report.summary}`);
    }
  }

  if (data.oql) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("OQL:");
    lines.push(`  Parser mode: ${data.oql.parser_mode}`);
    lines.push(`  Command format: ${data.oql.command_format}`);
    for (const rule of data.oql.client_input_rules) {
      lines.push(`  Rule: ${rule}`);
    }
  }

  if (data.errors) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("Errors:");
    for (const item of data.errors) {
      lines.push(`  ${item.category} - ${item.summary}`);
      lines.push(`  Remedy: ${item.remediation}`);
    }
  }

  return lines.join("\n");
}

function renderError(response: MatErrorResponse): string {
  return [
    `Error (${response.category})`,
    `Message: ${response.message}`,
    `Hint: ${response.hint}`,
    renderTail("stderr", response.stderr_tail),
    renderTail("stdout", response.stdout_tail)
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderPathList(title: string, paths: string[]): string {
  if (paths.length === 0) {
    return "";
  }
  return [title + ":", ...paths.map((item) => `  ${item}`)].join("\n");
}

function renderPreview(title: string, preview: string[]): string {
  if (preview.length === 0) {
    return "";
  }
  return [title + ":", ...preview.map((line) => `  ${line}`)].join("\n");
}

function renderTail(title: string, text: string): string {
  if (!text || text.trim().length === 0) {
    return "";
  }
  return `[${title}]\n${text.trimEnd()}`;
}

function renderFlatFindings(title: string, lines: string[]): string {
  if (lines.length === 0) {
    return "";
  }
  return [title + ":", ...lines.map((line) => `  ${line}`)].join("\n");
}

function renderWarnings(warnings: string[]): string {
  if (warnings.length === 0) {
    return "";
  }
  return ["Warnings:", ...warnings.map((item) => `  ${item}`)].join("\n");
}

function renderAnalysisArtifacts(artifacts: Array<{ kind: string; path: string }>): string {
  if (artifacts.length === 0) {
    return "";
  }
  return ["Artifacts:", ...artifacts.map((item) => `  ${item.kind}: ${item.path}`)].join("\n");
}

function formatHeapBytes(value: number | null): string {
  if (value === null || value === undefined) {
    return "unknown";
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function formatDelta(value: number | null): string {
  if (value === null || value === undefined) {
    return "unknown";
  }
  return `${value >= 0 ? "+" : ""}${value}`;
}

function applyOverflow(body: string, footer: string, overflowStore: OverflowStore): string {
  const lineCount = body.length === 0 ? 0 : body.split("\n").length;
  const byteCount = Buffer.byteLength(body, "utf8");
  if (lineCount <= MAX_OUTPUT_LINES && byteCount <= MAX_OUTPUT_BYTES) {
    return body.length > 0 ? `${body}\n${footer}` : footer;
  }

  const previewLines = body.split("\n").slice(0, MAX_OUTPUT_LINES).join("\n");
  const preview = truncateUtf8(previewLines, MAX_OUTPUT_BYTES);
  const overflowPath = overflowStore.write(body);
  const truncated = [
    preview,
    "",
    `--- output truncated (${lineCount} lines, ${formatBytes(byteCount)}) ---`,
    `Full output: ${overflowPath}`,
    `Explore: sed -n '1,120p' ${overflowPath}`,
    `         tail -n 100 ${overflowPath}`,
    footer
  ];
  return truncated.join("\n");
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const sliced = text.slice(0, mid);
    if (Buffer.byteLength(sliced, "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatFooter(exitCode: number, durationMs: number): string {
  return `[exit:${exitCode} | ${formatDuration(durationMs)}]`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${(durationMs / 60_000).toFixed(1)}m`;
}
