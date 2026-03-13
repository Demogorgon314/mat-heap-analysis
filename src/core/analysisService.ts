import path from "node:path";
import type { CliConfig } from "../config.js";
import type {
  AnalysisArtifact,
  CompareDeltaEntry,
  HistogramEntry,
  HotspotEntry,
  LeakAccumulationStep,
  LeakSuspectFinding,
  MatArtifactPreviewSuccess,
  MatCompareSuccess,
  MatErrorResponse,
  MatInspectObjectSuccess,
  MatTriageSuccess
} from "../types.js";
import { MatService, type MatRunCommandInput, type MatServiceDeps, type ParseReportInput } from "./service.js";
import { ensureAllowedHeapPath } from "./pathGuard.js";
import { parseNumericValue, stripTreePrefix } from "./html.js";
import {
  buildArtifacts,
  parseCompareDeltaRows,
  parseLeakSuspectsArtifact,
  parseOverviewArtifact,
  parseSinglePageArtifact,
  previewArtifact
} from "./reportParser.js";
import { createWorkflowWorkspace } from "./workspace.js";

export interface TriageInput {
  heap_path: string;
  top?: number;
  xmx_mb?: number;
  timeout_sec?: number;
}

export interface InspectObjectInput {
  heap_path: string;
  object_id: string;
  xmx_mb?: number;
  timeout_sec?: number;
}

export interface CompareInput {
  heap_path: string;
  baseline_heap_path: string;
  top?: number;
  xmx_mb?: number;
  timeout_sec?: number;
}

export interface ShowArtifactInput {
  artifact_path: string;
  entry?: string;
}

export class AnalysisService {
  constructor(private readonly config: CliConfig, private readonly deps?: Partial<MatServiceDeps>) {}

  async triage(input: TriageInput): Promise<MatTriageSuccess | MatErrorResponse> {
    try {
      const top = normalizeTop(input.top);
      const sourceHeapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      const workspace = createWorkflowWorkspace(this.config.matDataDir, [], { label: "triage" });
      const overviewWorkspace = createWorkflowWorkspace(this.config.matDataDir, [{ key: "heap", heapPath: sourceHeapPath }], { parent_dir: workspace.run_dir, label: "overview" });
      const suspectsWorkspace = createWorkflowWorkspace(this.config.matDataDir, [{ key: "heap", heapPath: sourceHeapPath }], { parent_dir: workspace.run_dir, label: "suspects" });
      const histogramWorkspace = createWorkflowWorkspace(this.config.matDataDir, [{ key: "heap", heapPath: sourceHeapPath }], { parent_dir: workspace.run_dir, label: "histogram" });

      const warnings: string[] = [];
      const artifacts: AnalysisArtifact[] = [{ kind: "workspace", path: workspace.run_dir }];

      const overview = await this.createWorkflowService(overviewWorkspace.run_dir).parseReport(
        buildReportInput(overviewWorkspace.heaps.heap.execution_heap_path, "org.eclipse.mat.api:overview", input)
      );
      const suspects = await this.createWorkflowService(suspectsWorkspace.run_dir).parseReport(
        buildReportInput(suspectsWorkspace.heaps.heap.execution_heap_path, "org.eclipse.mat.api:suspects", input)
      );
      const histogram = await this.createWorkflowService(histogramWorkspace.run_dir).runCommand(
        buildRunInput(histogramWorkspace.heaps.heap.execution_heap_path, "histogram", undefined, input, "html")
      );

      const overviewArtifact = extractArtifactPath(overview, "report");
      const suspectsArtifact = extractArtifactPath(suspects, "report");
      const histogramArtifact = extractArtifactPath(histogram, "query");
      artifacts.push(...buildArtifacts([
        { kind: "report_dir", path: overview.status === "ok" ? overview.report_dir : null },
        { kind: "report_zip", path: overview.status === "ok" ? overview.report_zip : null },
        { kind: "report_dir", path: suspects.status === "ok" ? suspects.report_dir : null },
        { kind: "report_zip", path: suspects.status === "ok" ? suspects.report_zip : null },
        { kind: "query_dir", path: histogram.status === "ok" ? histogram.query_dir : null },
        { kind: "query_zip", path: histogram.status === "ok" ? histogram.query_zip : null },
        { kind: "result_txt", path: histogram.status === "ok" ? histogram.result_txt : null }
      ]));

      const overviewParsed = tryParse(() => (overviewArtifact ? parseOverviewArtifact(overviewArtifact) : null), warnings, "overview");
      const suspectsParsed = tryParse(() => (suspectsArtifact ? parseLeakSuspectsArtifact(suspectsArtifact) : null), warnings, "suspects");
      const histogramParsed = tryParse(() => (histogramArtifact ? parseSinglePageArtifact(histogramArtifact) : null), warnings, "histogram");

      if (!overviewParsed && !suspectsParsed && !histogramParsed) {
        return this.createWorkflowError("triage", [overview, suspects, histogram], warnings);
      }

      if (overview.status === "error") {
        warnings.push(`overview failed: ${overview.message}`);
      }
      if (suspects.status === "error") {
        warnings.push(`suspects failed: ${suspects.message}`);
      }
      if (histogram.status === "error") {
        warnings.push(`histogram failed: ${histogram.message}`);
      }

      const hotspots = (overviewParsed?.biggestObjects ?? []).slice(0, top);
      const dominatorClasses = (overviewParsed?.dominatorClasses ?? []).slice(0, top);
      const dominantPackages = (overviewParsed?.dominantPackages ?? []).slice(0, top);
      const histogramRows = extractHistogramRows(histogramParsed).slice(0, top);
      const histogramData = histogramRows.length > 0 && histogramRows.some((row) => row.retained_heap_bytes !== null)
        ? histogramRows
        : (overviewParsed?.histogram ?? []).slice(0, top);
      const suspectsData = (suspectsParsed?.suspects ?? []).slice(0, top);

      return {
        status: "ok",
        heap_path: sourceHeapPath,
        workspace_dir: workspace.run_dir,
        summary: buildTriageSummary(hotspots, suspectsData),
        warnings: uniqueStrings(warnings),
        hotspots,
        dominator_classes: dominatorClasses,
        dominant_packages: dominantPackages,
        histogram: histogramData,
        suspects: suspectsData,
        next_steps: buildTriageNextSteps(input.heap_path, hotspots, suspectsData, artifacts),
        artifacts
      };
    } catch (error) {
      return normalizeUnexpectedError(error);
    }
  }

  async inspectObject(input: InspectObjectInput): Promise<MatInspectObjectSuccess | MatErrorResponse> {
    try {
      if (!/^0x[0-9a-fA-F]+$/.test(input.object_id.trim())) {
        return createUsageError("inspect-object requires --object-id in MAT hex form, for example 0xc2300098.");
      }

      const sourceHeapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      const workspace = createWorkflowWorkspace(this.config.matDataDir, [], { label: "inspect" });
      const pathWorkspace = createWorkflowWorkspace(this.config.matDataDir, [{ key: "heap", heapPath: sourceHeapPath }], { parent_dir: workspace.run_dir, label: "path2gc" });
      const dominatorWorkspace = createWorkflowWorkspace(this.config.matDataDir, [{ key: "heap", heapPath: sourceHeapPath }], { parent_dir: workspace.run_dir, label: "dominator" });
      const retainedWorkspace = createWorkflowWorkspace(this.config.matDataDir, [{ key: "heap", heapPath: sourceHeapPath }], { parent_dir: workspace.run_dir, label: "retained" });

      const warnings: string[] = [];
      const pathResult = await this.createWorkflowService(pathWorkspace.run_dir).runCommand(
        buildRunInput(pathWorkspace.heaps.heap.execution_heap_path, "path2gc", input.object_id, input, "html")
      );
      const dominatorResult = await this.createWorkflowService(dominatorWorkspace.run_dir).runCommand(
        buildRunInput(dominatorWorkspace.heaps.heap.execution_heap_path, "show_dominator_tree", input.object_id, input, "html")
      );
      const retainedResult = await this.createWorkflowService(retainedWorkspace.run_dir).runCommand(
        buildRunInput(retainedWorkspace.heaps.heap.execution_heap_path, "show_retained_set", input.object_id, input, "html")
      );

      const artifacts: AnalysisArtifact[] = [
        { kind: "workspace", path: workspace.run_dir },
        ...buildArtifacts([
          { kind: "query_dir", path: pathResult.status === "ok" ? pathResult.query_dir : null },
          { kind: "query_zip", path: pathResult.status === "ok" ? pathResult.query_zip : null },
          { kind: "query_dir", path: dominatorResult.status === "ok" ? dominatorResult.query_dir : null },
          { kind: "query_zip", path: dominatorResult.status === "ok" ? dominatorResult.query_zip : null },
          { kind: "query_dir", path: retainedResult.status === "ok" ? retainedResult.query_dir : null },
          { kind: "query_zip", path: retainedResult.status === "ok" ? retainedResult.query_zip : null }
        ])
      ];

      const pathParsed = tryParse(() => {
        const artifact = extractArtifactPath(pathResult, "query");
        return artifact ? parseSinglePageArtifact(artifact) : null;
      }, warnings, "path2gc");
      const dominatorParsed = tryParse(() => {
        const artifact = extractArtifactPath(dominatorResult, "query");
        return artifact ? parseSinglePageArtifact(artifact) : null;
      }, warnings, "show_dominator_tree");
      const retainedParsed = tryParse(() => {
        const artifact = extractArtifactPath(retainedResult, "query");
        return artifact ? parseSinglePageArtifact(artifact) : null;
      }, warnings, "show_retained_set");

      if (!pathParsed && !dominatorParsed && !retainedParsed) {
        return this.createWorkflowError("inspect-object", [pathResult, dominatorResult, retainedResult], warnings);
      }

      if (pathResult.status === "error") {
        warnings.push(`path2gc failed: ${pathResult.message}`);
      }
      if (dominatorResult.status === "error") {
        warnings.push(`show_dominator_tree failed: ${dominatorResult.message}`);
      }
      if (retainedResult.status === "error") {
        warnings.push(`show_retained_set failed: ${retainedResult.message}`);
      }

      const gcRootPath = extractPathRows(pathParsed);
      const dominators = extractGenericHotspots(dominatorParsed);
      const retainedObjects = extractHistogramRows(retainedParsed);

      return {
        status: "ok",
        heap_path: sourceHeapPath,
        object_id: input.object_id,
        workspace_dir: workspace.run_dir,
        summary: buildInspectSummary(input.object_id, gcRootPath, dominators),
        warnings: uniqueStrings(warnings),
        gc_root_path: gcRootPath,
        dominators,
        retained_objects: retainedObjects,
        next_steps: buildInspectNextSteps(input.heap_path, dominators, artifacts),
        artifacts
      };
    } catch (error) {
      return normalizeUnexpectedError(error);
    }
  }

  async compare(input: CompareInput): Promise<MatCompareSuccess | MatErrorResponse> {
    try {
      const top = normalizeTop(input.top);
      const sourceHeapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      const baselineHeapPath = ensureAllowedHeapPath(input.baseline_heap_path, this.config.allowedRoots);
      const workspace = createWorkflowWorkspace(this.config.matDataDir, [], { label: "compare" });
      const compareWorkspace = createWorkflowWorkspace(this.config.matDataDir, [
        { key: "heap", heapPath: sourceHeapPath },
        { key: "baseline", heapPath: baselineHeapPath }
      ], { parent_dir: workspace.run_dir, label: "report" });
      const report = await this.createWorkflowService(compareWorkspace.run_dir).parseReport({
        heap_path: compareWorkspace.heaps.heap.execution_heap_path,
        report_id: "org.eclipse.mat.api:compare",
        options: {
          snapshot2: compareWorkspace.heaps.baseline.execution_heap_path
        },
        xmx_mb: input.xmx_mb,
        timeout_sec: input.timeout_sec
      });

      const warnings: string[] = [];
      const artifacts: AnalysisArtifact[] = [
        { kind: "workspace", path: workspace.run_dir },
        ...buildArtifacts([
          { kind: "report_dir", path: report.status === "ok" ? report.report_dir : null },
          { kind: "report_zip", path: report.status === "ok" ? report.report_zip : null }
        ])
      ];

      if (report.status === "error") {
        return this.createWorkflowError("compare", [report], warnings);
      }

      const artifactPath = extractArtifactPath(report, "report");
      const parsed = tryParse(() => (artifactPath ? parseSinglePageArtifact(artifactPath) : null), warnings, "compare");
      if (!parsed) {
        return this.createWorkflowError("compare", [report], warnings);
      }

      const histogramDelta = parseCompareDeltaRows(parsed).slice(0, top);
      const csvArtifact = parsed.entries.find((entry) => entry.toLowerCase().endsWith(".csv"));
      if (csvArtifact) {
        artifacts.push({
          kind: "csv",
          path: report.report_zip ? `${path.resolve(report.report_zip)}:${csvArtifact}` : `${artifactPath}:${csvArtifact}`
        });
      }

      return {
        status: "ok",
        heap_path: sourceHeapPath,
        baseline_heap_path: baselineHeapPath,
        workspace_dir: workspace.run_dir,
        summary: buildCompareSummary(histogramDelta),
        warnings: uniqueStrings(warnings),
        histogram_delta: histogramDelta,
        next_steps: buildCompareNextSteps(input.heap_path, artifacts),
        artifacts
      };
    } catch (error) {
      return normalizeUnexpectedError(error);
    }
  }

  showArtifact(input: ShowArtifactInput): MatArtifactPreviewSuccess | MatErrorResponse {
    try {
      return previewArtifact(input.artifact_path, input.entry, this.config.resultPreviewLines);
    } catch (error) {
      return normalizeUnexpectedError(error);
    }
  }

  private createWorkflowService(runDir: string): MatService {
    return new MatService(
      {
        ...this.config,
        allowedRoots: uniqueStrings([...this.config.allowedRoots, runDir])
      },
      this.deps
    );
  }

  private createWorkflowError(
    commandName: string,
    results: Array<{ status: "ok" } | MatErrorResponse>,
    warnings: string[]
  ): MatErrorResponse {
    const firstError = results.find((result): result is MatErrorResponse => result.status === "error");
    if (firstError) {
      return {
        ...firstError,
        message: `${commandName} did not produce any usable analysis results. ${firstError.message}`,
        hint: uniqueStrings([...warnings, firstError.hint]).join(" ")
      };
    }
    return createUsageError(`${commandName} did not produce any usable analysis results.`);
  }
}

function buildReportInput(
  heapPath: string,
  reportId: string,
  input: { xmx_mb?: number; timeout_sec?: number }
): ParseReportInput {
  return {
    heap_path: heapPath,
    report_id: reportId,
    xmx_mb: input.xmx_mb,
    timeout_sec: input.timeout_sec
  };
}

function buildRunInput(
  heapPath: string,
  commandName: string,
  commandArgs: string | undefined,
  input: { xmx_mb?: number; timeout_sec?: number },
  format: "txt" | "html" | "csv"
): MatRunCommandInput {
  return {
    heap_path: heapPath,
    command_name: commandName,
    command_args: commandArgs,
    format,
    unzip: true,
    xmx_mb: input.xmx_mb,
    timeout_sec: input.timeout_sec
  };
}

function extractArtifactPath(
  result: { status: "ok"; report_dir?: string | null; report_zip?: string | null; query_dir?: string | null; query_zip?: string | null } | MatErrorResponse,
  kind: "report" | "query"
): string | null {
  if (result.status === "error") {
    return null;
  }
  return kind === "report" ? result.report_dir ?? result.report_zip ?? null : result.query_dir ?? result.query_zip ?? null;
}

function extractHistogramRows(artifact: { sections: Array<{ heading: string; table_headers: string[]; rows: string[][]; row_object_ids: Array<string | null> }> } | null): HistogramEntry[] {
  const section = artifact?.sections.find((item) => /Query Command|Class Histogram/i.test(item.heading));
  if (!section) {
    return [];
  }
  return section.rows
    .map((row, index) => ({
      label: cleanTableLabel(row[0] ?? ""),
      object_id: section.row_object_ids[index] ?? null,
      object_count: parseNumericValue(row[1] ?? ""),
      shallow_heap_bytes: parseNumericValue(row[2] ?? ""),
      retained_heap_bytes: parseNumericValue(row[3] ?? ""),
      retained_percent: null
    }))
    .filter((item) => item.label.length > 0 && !/^Total:/i.test(item.label));
}

function extractGenericHotspots(artifact: { sections: Array<{ heading: string; rows: string[][]; row_object_ids: Array<string | null> }> } | null): HotspotEntry[] {
  const section = artifact?.sections.find((item) => /Query Command/i.test(item.heading));
  if (!section) {
    return [];
  }
  return section.rows
    .map((row, index) => ({
      label: cleanTableLabel(row[0] ?? ""),
      object_id: section.row_object_ids[index] ?? null,
      object_count: null,
      shallow_heap_bytes: parseNumericValue(row[1] ?? row[row.length - 2] ?? ""),
      retained_heap_bytes: parseNumericValue(row[2] ?? row[row.length - 1] ?? ""),
      retained_percent: row.length > 3 ? parseNumericValue(row[3] ?? "") : null
    }))
    .filter((item) => item.label.length > 0 && !/^Total:/i.test(item.label));
}

function extractPathRows(artifact: { sections: Array<{ heading: string; rows: string[][]; row_object_ids: Array<string | null> }> } | null): LeakAccumulationStep[] {
  const section = artifact?.sections.find((item) => /Query Command/i.test(item.heading));
  if (!section) {
    return [];
  }
  return section.rows
    .map((row, index) => ({
      label: cleanTableLabel(row[0] ?? ""),
      reference_label: extractReferenceLabel(cleanTableLabel(row[0] ?? "")),
      object_id: section.row_object_ids[index] ?? null,
      shallow_heap_bytes: parseNumericValue(row[row.length - 2] ?? ""),
      retained_heap_bytes: parseNumericValue(row[row.length - 1] ?? "")
    }))
    .filter((item) => item.label.length > 0 && !/^Total:/i.test(item.label));
}

function buildTriageSummary(hotspots: HotspotEntry[], suspects: LeakSuspectFinding[]): string {
  const primarySuspect = suspects[0];
  if (primarySuspect) {
    return `${primarySuspect.suspect_id}: ${primarySuspect.headline}`;
  }
  const primaryHotspot = hotspots[0];
  if (primaryHotspot) {
    return `Largest retained object is ${primaryHotspot.label} (${formatBytes(primaryHotspot.retained_heap_bytes)} retained).`;
  }
  return "Triage completed with partial findings.";
}

function buildInspectSummary(objectId: string, pathRows: LeakAccumulationStep[], dominators: HotspotEntry[]): string {
  const lastPath = pathRows[pathRows.length - 1];
  if (lastPath) {
    return `${objectId} is retained through ${lastPath.label}.`;
  }
  const dominator = dominators[0];
  if (dominator) {
    return `${objectId} appears under dominator ${dominator.label}.`;
  }
  return `Inspection completed for ${objectId}.`;
}

function buildCompareSummary(delta: CompareDeltaEntry[]): string {
  const first = delta[0];
  if (!first) {
    return "No class histogram deltas were reported.";
  }
  return `Largest class delta is ${first.label} (${formatSignedNumber(first.object_count_delta)} objects, ${formatSignedBytes(first.shallow_heap_delta_bytes)} shallow).`;
}

function buildTriageNextSteps(
  heapPath: string,
  hotspots: HotspotEntry[],
  suspects: LeakSuspectFinding[],
  artifacts: AnalysisArtifact[]
): string[] {
  const steps: string[] = [];
  const suspectObjectId = suspects.find((item) => item.object_id)?.object_id;
  if (suspectObjectId) {
    steps.push(`mat inspect-object --heap ${heapPath} --object-id ${suspectObjectId}`);
  }
  const hotspotObjectId = hotspots.find((item) => item.object_id)?.object_id;
  if (hotspotObjectId && hotspotObjectId !== suspectObjectId) {
    steps.push(`mat inspect-object --heap ${heapPath} --object-id ${hotspotObjectId}`);
  }
  const artifactPath = artifacts.find((item) => item.kind === "report_zip" || item.kind === "report_dir")?.path;
  if (artifactPath) {
    steps.push(`mat show-artifact ${artifactPath}`);
  }
  return uniqueStrings(steps).slice(0, 3);
}

function buildInspectNextSteps(heapPath: string, dominators: HotspotEntry[], artifacts: AnalysisArtifact[]): string[] {
  const steps: string[] = [];
  const dominatorObjectId = dominators.find((item) => item.object_id)?.object_id;
  if (dominatorObjectId) {
    steps.push(`mat inspect-object --heap ${heapPath} --object-id ${dominatorObjectId}`);
  }
  const artifactPath = artifacts.find((item) => item.kind === "query_dir" || item.kind === "query_zip")?.path;
  if (artifactPath) {
    steps.push(`mat show-artifact ${artifactPath}`);
  }
  return uniqueStrings(steps).slice(0, 3);
}

function buildCompareNextSteps(heapPath: string, artifacts: AnalysisArtifact[]): string[] {
  const steps = [`mat triage --heap ${heapPath}`];
  const artifactPath = artifacts.find((item) => item.kind === "report_zip")?.path ?? artifacts.find((item) => item.kind === "report_dir")?.path;
  if (artifactPath) {
    steps.push(`mat show-artifact ${artifactPath}`);
  }
  return uniqueStrings(steps);
}

function extractReferenceLabel(label: string): string | null {
  const parts = label.split(" ");
  if (parts.length < 2) {
    return null;
  }
  const first = parts[0].trim();
  return first.length > 0 && /^[a-zA-Z[\]]/.test(first) ? first : null;
}

function cleanTableLabel(label: string): string {
  return stripTreePrefix(label.replace(/\s+/g, " ").trim());
}

function normalizeTop(value: number | undefined): number {
  if (value === undefined) {
    return 10;
  }
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    return 10;
  }
  return value;
}

function formatBytes(value: number | null): string {
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

function formatSignedBytes(value: number | null): string {
  if (value === null || value === undefined) {
    return "unknown";
  }
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${formatBytes(Math.abs(value))}`;
}

function formatSignedNumber(value: number | null): string {
  if (value === null || value === undefined) {
    return "unknown";
  }
  return `${value >= 0 ? "+" : ""}${value}`;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))];
}

function tryParse<T>(factory: () => T | null, warnings: string[], label: string): T | null {
  try {
    return factory();
  } catch (error) {
    warnings.push(`${label} parser failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function normalizeUnexpectedError(error: unknown): MatErrorResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: "error",
    category: "MAT_PARSE_FAILED",
    message,
    hint: "Unexpected analysis error. Check the generated artifacts for more detail.",
    stdout_tail: "",
    stderr_tail: "",
    exit_code: null
  };
}

function createUsageError(message: string): MatErrorResponse {
  return {
    status: "error",
    category: "CLI_USAGE",
    message,
    hint: "Use --help for command-specific usage.",
    stdout_tail: "",
    stderr_tail: "",
    exit_code: null
  };
}
