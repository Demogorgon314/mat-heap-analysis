export type MatErrorCategory =
  | "MAT_NOT_FOUND"
  | "HEAP_NOT_FOUND"
  | "WRITE_PERMISSION_DENIED"
  | "MAT_PARSE_FAILED"
  | "MAT_TIMEOUT"
  | "INVALID_QUERY"
  | "CLI_USAGE";

export interface MatErrorResponse {
  status: "error";
  category: MatErrorCategory;
  message: string;
  hint: string;
  stdout_tail: string;
  stderr_tail: string;
  exit_code: number | null;
}

export interface RunCommand {
  command: string;
  args: string[];
  timeoutSec: number;
}

export interface RunResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface MatParseReportSuccess {
  status: "ok";
  exit_code: number;
  report_dir: string | null;
  report_zip: string | null;
  generated_files: string[];
  stdout_tail: string;
  stderr_tail: string;
}

export interface MatOqlQuerySuccess {
  status: "ok";
  exit_code: number;
  query_dir: string | null;
  query_zip: string | null;
  result_txt: string | null;
  result_preview: string[];
  generated_files: string[];
  stdout_tail: string;
  stderr_tail: string;
}

export interface MatHealthcheckSuccess {
  status: "ok";
  ok: true;
  mat_launcher: string;
  java_version: string;
  notes: string[];
}

export interface MatIndexStatusSuccess {
  status: "ok";
  index_present: boolean;
  index_files: string[];
  threads_file: string | null;
  last_modified: string | null;
}

export interface MatOqlSpecSuccess {
  status: "ok";
  parser_mode: string;
  command_format: string;
  client_input_rules: string[];
  supported_patterns: Array<{
    name: string;
    query: string;
    description: string;
  }>;
  unsupported_patterns: string[];
  notes: string[];
}

export interface MatRunCommandSuccess {
  status: "ok";
  exit_code: number;
  command_name: string;
  query_dir: string | null;
  query_zip: string | null;
  result_txt: string | null;
  result_preview: string[];
  generated_files: string[];
  stdout_tail: string;
  stderr_tail: string;
}

export interface AnalysisArtifact {
  kind: "workspace" | "report_dir" | "report_zip" | "query_dir" | "query_zip" | "result_txt" | "csv" | "artifact";
  path: string;
}

export interface HotspotEntry {
  label: string;
  object_id: string | null;
  object_count: number | null;
  shallow_heap_bytes: number | null;
  retained_heap_bytes: number | null;
  retained_percent: number | null;
}

export interface HistogramEntry extends HotspotEntry {}

export interface LeakAccumulationStep {
  label: string;
  reference_label: string | null;
  object_id: string | null;
  shallow_heap_bytes: number | null;
  retained_heap_bytes: number | null;
}

export interface LeakSuspectFinding {
  suspect_id: string;
  headline: string;
  summary: string;
  retained_heap_bytes: number | null;
  retained_percent: number | null;
  object_label: string | null;
  object_id: string | null;
  accumulation_path: LeakAccumulationStep[];
  dominant_classes: HistogramEntry[];
  keywords: string[];
  thread_name: string | null;
  stack_preview: string[];
}

export interface QuerySectionSummary {
  heading: string;
  table_headers: string[];
  rows: string[][];
  row_object_ids: Array<string | null>;
  row_count: number;
  preformatted: string | null;
  preview: string[];
}

export interface ParsedHtmlArtifact {
  title: string;
  source: string;
  summary_text: string;
  sections: QuerySectionSummary[];
  entries: string[];
}

export interface CompareDeltaEntry {
  label: string;
  object_count_delta: number | null;
  shallow_heap_delta_bytes: number | null;
  note: string | null;
}

export interface MatTriageSuccess {
  status: "ok";
  heap_path: string;
  workspace_dir: string;
  summary: string;
  warnings: string[];
  hotspots: HotspotEntry[];
  dominator_classes: HotspotEntry[];
  dominant_packages: HotspotEntry[];
  histogram: HistogramEntry[];
  suspects: LeakSuspectFinding[];
  next_steps: string[];
  artifacts: AnalysisArtifact[];
}

export interface MatInspectObjectSuccess {
  status: "ok";
  heap_path: string;
  object_id: string;
  workspace_dir: string;
  summary: string;
  warnings: string[];
  gc_root_path: LeakAccumulationStep[];
  dominators: HotspotEntry[];
  retained_objects: HistogramEntry[];
  next_steps: string[];
  artifacts: AnalysisArtifact[];
}

export interface MatCompareSuccess {
  status: "ok";
  heap_path: string;
  baseline_heap_path: string;
  workspace_dir: string;
  summary: string;
  warnings: string[];
  histogram_delta: CompareDeltaEntry[];
  next_steps: string[];
  artifacts: AnalysisArtifact[];
}

export interface MatArtifactPreviewSuccess {
  status: "ok";
  artifact_path: string;
  artifact_type: "directory" | "zip" | "html" | "text";
  selected_entry: string | null;
  entries: string[];
  preview: string[];
  truncated: boolean;
  summary: string;
}

export interface CatalogCommandEntry {
  name: string;
  summary: string;
  usage: string;
  examples: string[];
  related: string[];
}

export interface CatalogReportEntry {
  id: string;
  summary: string;
  examples: string[];
}

export interface CatalogErrorEntry {
  category: Exclude<MatErrorCategory, "CLI_USAGE">;
  summary: string;
  remediation: string;
}

export interface CatalogPayload {
  commands: CatalogCommandEntry[];
  reports: CatalogReportEntry[];
  oql: Omit<MatOqlSpecSuccess, "status">;
  errors: CatalogErrorEntry[];
}

export type CatalogSection = "all" | "commands" | "reports" | "oql" | "errors";

export interface CatalogSuccess {
  status: "ok";
  section: CatalogSection;
  commands?: CatalogCommandEntry[];
  reports?: CatalogReportEntry[];
  oql?: Omit<MatOqlSpecSuccess, "status">;
  errors?: CatalogErrorEntry[];
}

export type CommandResponse =
  | MatHealthcheckSuccess
  | MatParseReportSuccess
  | MatOqlQuerySuccess
  | MatIndexStatusSuccess
  | MatOqlSpecSuccess
  | MatRunCommandSuccess
  | MatTriageSuccess
  | MatInspectObjectSuccess
  | MatCompareSuccess
  | MatArtifactPreviewSuccess
  | CatalogSuccess
  | MatErrorResponse;

export class MatCliError extends Error {
  public readonly category: MatErrorCategory;
  public readonly hint: string;
  public readonly stdoutTail: string;
  public readonly stderrTail: string;
  public readonly exitCode: number | null;

  constructor(params: {
    category: MatErrorCategory;
    message: string;
    hint: string;
    stdoutTail?: string;
    stderrTail?: string;
    exitCode?: number | null;
  }) {
    super(params.message);
    this.name = "MatCliError";
    this.category = params.category;
    this.hint = params.hint;
    this.stdoutTail = params.stdoutTail ?? "";
    this.stderrTail = params.stderrTail ?? "";
    this.exitCode = params.exitCode ?? null;
  }

  toResponse(): MatErrorResponse {
    return {
      status: "error",
      category: this.category,
      message: this.message,
      hint: this.hint,
      stdout_tail: this.stdoutTail,
      stderr_tail: this.stderrTail,
      exit_code: this.exitCode,
    };
  }
}
