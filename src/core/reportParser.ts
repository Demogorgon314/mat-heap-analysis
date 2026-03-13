import fs from "node:fs";
import path from "node:path";
import type {
  AnalysisArtifact,
  CompareDeltaEntry,
  HistogramEntry,
  HotspotEntry,
  LeakAccumulationStep,
  LeakSuspectFinding,
  MatArtifactPreviewSuccess,
  ParsedHtmlArtifact,
  QuerySectionSummary
} from "../types.js";
import { openArtifactSource, type ArtifactSource } from "./archive.js";
import {
  extractHtmlLinks,
  extractHtmlTitle,
  extractSections,
  findSection,
  findSectionMatching,
  normalizeHtmlText,
  parseNumericValue,
  stripTreePrefix,
  type ParsedCell,
  type ParsedSection,
  type ParsedTable
} from "./html.js";

export interface ParsedOverviewReport {
  title: string;
  biggestObjects: HotspotEntry[];
  dominatorClasses: HotspotEntry[];
  dominantPackages: HotspotEntry[];
  histogram: HistogramEntry[];
}

export interface ParsedLeakSuspectsReport {
  title: string;
  suspects: LeakSuspectFinding[];
}

export function parseOverviewArtifact(artifactPath: string): ParsedOverviewReport {
  const source = openArtifactSource(artifactPath);
  const tocText = readRequiredEntry(source, "toc.html");
  const tocLinks = extractHtmlLinks(tocText);
  const topConsumersPath = normalizeHrefToPath(findHrefByText(tocLinks, /^Top Consumers$/i));
  const histogramPath = normalizeHrefToPath(findHrefByText(tocLinks, /^Class Histogram$/i));

  const topConsumersText = readRequiredEntry(source, topConsumersPath);
  const topConsumersSections = extractSections(topConsumersText);
  const histogramText = readRequiredEntry(source, histogramPath);
  const histogramSections = extractSections(histogramText);

  return {
    title: extractHtmlTitle(topConsumersText) ?? "System Overview",
    biggestObjects: parseHotspotTable(findSection(topConsumersSections, "Biggest Objects")?.table),
    dominatorClasses: parseDominatorTable(findSection(topConsumersSections, "Biggest Top-Level Dominator Classes")?.table),
    dominantPackages: parsePackageTable(findSection(topConsumersSections, "Biggest Top-Level Dominator Packages")?.table),
    histogram: parseHistogramTable(findSection(histogramSections, "Class Histogram")?.table)
  };
}

export function parseLeakSuspectsArtifact(artifactPath: string): ParsedLeakSuspectsReport {
  const source = openArtifactSource(artifactPath);
  const title = extractHtmlTitle(readRequiredEntry(source, "toc.html")) ?? "Leak Suspects";
  const entries = source
    .listEntries()
    .filter((entry) => entry.path.startsWith("pages/") && entry.path.endsWith(".html"))
    .map((entry) => entry.path)
    .sort();

  const suspects = entries
    .map((entryPath) => {
      const page = source.readText(entryPath);
      if (!page) {
        return null;
      }
      const pageTitle = extractHtmlTitle(page);
      if (!pageTitle || !/^Problem Suspect \d+$/i.test(pageTitle)) {
        return null;
      }
      return parseLeakSuspectPage(pageTitle, page);
    })
    .filter((item): item is LeakSuspectFinding => item !== null);

  return {
    title,
    suspects
  };
}

export function parseSinglePageArtifact(artifactPath: string): ParsedHtmlArtifact {
  const source = openArtifactSource(artifactPath);
  const html = readRequiredEntry(source, "index.html");
  return parseSinglePageHtml(html, artifactPath, source.listEntries().map((entry) => entry.path));
}

export function previewArtifact(
  artifactPath: string,
  entry: string | undefined,
  previewLines: number
): MatArtifactPreviewSuccess {
  const absolute = path.resolve(artifactPath);
  const stat = safeStat(absolute);

  if (!stat) {
    throw new Error(`Artifact does not exist: ${absolute}`);
  }

  if (stat.isDirectory()) {
    const source = openArtifactSource(absolute);
    const entries = source.listEntries().map((item) => item.path);
    const selectedEntry = entry ? normalizeHrefToPath(entry) : null;
    if (selectedEntry) {
      return previewTextEntry(absolute, "directory", selectedEntry, source.readText(selectedEntry), entries, previewLines);
    }
    return {
      status: "ok",
      artifact_path: absolute,
      artifact_type: "directory",
      selected_entry: null,
      entries,
      preview: entries.slice(0, previewLines),
      truncated: entries.length > previewLines,
      summary: `Directory artifact with ${entries.length} entries.`
    };
  }

  if (absolute.toLowerCase().endsWith(".zip")) {
    const source = openArtifactSource(absolute);
    const entries = source.listEntries().filter((item) => !item.isDirectory).map((item) => item.path);
    const selectedEntry = entry ? normalizeHrefToPath(entry) : null;
    if (selectedEntry) {
      return previewTextEntry(absolute, "zip", selectedEntry, source.readText(selectedEntry), entries, previewLines);
    }
    return {
      status: "ok",
      artifact_path: absolute,
      artifact_type: "zip",
      selected_entry: null,
      entries,
      preview: entries.slice(0, previewLines),
      truncated: entries.length > previewLines,
      summary: `Zip artifact with ${entries.length} entries.`
    };
  }

  const extension = path.extname(absolute).toLowerCase();
  const text = extension === ".html" || extension === ".htm" ? parseSinglePageHtml(readRequiredFile(absolute), absolute).summary_text : readRequiredFile(absolute);
  const lines = splitPreviewLines(text, previewLines);
  return {
    status: "ok",
    artifact_path: absolute,
    artifact_type: extension === ".html" || extension === ".htm" ? "html" : "text",
    selected_entry: null,
    entries: [],
    preview: lines,
    truncated: text.split(/\r?\n/).length > lines.length,
    summary: extension === ".html" || extension === ".htm" ? "HTML artifact preview." : "Text artifact preview."
  };
}

function previewTextEntry(
  artifactPath: string,
  artifactType: "directory" | "zip",
  entry: string,
  text: string | null,
  entries: string[],
  previewLines: number
): MatArtifactPreviewSuccess {
  if (text === null) {
    throw new Error(`Artifact entry is not readable text: ${entry}`);
  }
  const content = entry.toLowerCase().endsWith(".html") || entry.toLowerCase().endsWith(".htm")
    ? parseSinglePageHtml(text, `${artifactPath}:${entry}`).summary_text
    : text;
  const lines = splitPreviewLines(content, previewLines);
  return {
    status: "ok",
    artifact_path: artifactPath,
    artifact_type: artifactType,
    selected_entry: entry,
    entries,
    preview: lines,
    truncated: content.split(/\r?\n/).length > lines.length,
    summary: `Preview for ${entry}.`
  };
}

function parseLeakSuspectPage(title: string, html: string): LeakSuspectFinding {
  const sections = extractSections(html);
  const descriptionSection = findSection(sections, "Description");
  const pathSection = findSectionMatching(sections, /(Shortest Paths|Common Path) To the Accumulation Point/i);
  const byClassSection = findSection(sections, "All Accumulated Objects by Class") ?? findSection(sections, "Suspect Objects by Class");
  const threadStackSection = findSection(sections, "Thread Stack");
  const descriptionText = descriptionSection?.text ?? "";
  const retained = parseDescriptionRetained(descriptionText);
  const accumulationPath = parseAccumulationPath(pathSection?.table);
  const dominantClasses = parseHistogramTable(byClassSection?.table);
  const keywords = extractKeywords(descriptionSection?.html ?? "");
  const threadName = extractThreadName(descriptionText, threadStackSection?.preformatted ?? null);

  return {
    suspect_id: title,
    headline: firstNonEmptyLine(descriptionText) ?? title,
    summary: descriptionText,
    retained_heap_bytes: retained.bytes,
    retained_percent: retained.percent,
    object_label: accumulationPath[0]?.label ?? null,
    object_id: accumulationPath[0]?.object_id ?? null,
    accumulation_path: accumulationPath,
    dominant_classes: dominantClasses,
    keywords,
    thread_name: threadName,
    stack_preview: splitPreviewLines(threadStackSection?.preformatted ?? "", 8)
  };
}

function parseSinglePageHtml(html: string, sourceLabel: string, entries: string[] = []): ParsedHtmlArtifact {
  const title = extractHtmlTitle(html) ?? "Artifact";
  const sections = extractSections(html);
  const querySections: QuerySectionSummary[] = sections
    .filter((section) => section.level >= 5 || section.level === 1)
    .map((section) => ({
      heading: section.heading,
      table_headers: section.table?.headers ?? [],
      rows: section.table ? section.table.rows.map((row) => row.map((cell) => cell.lines[0] ?? cell.text)) : [],
      row_object_ids: section.table ? section.table.rows.map((row) => row[0]?.objectId ?? null) : [],
      row_count: section.table?.rows.length ?? 0,
      preformatted: section.preformatted,
      preview: buildSectionPreview(section)
    }));

  return {
    title,
    source: sourceLabel,
    summary_text: buildArtifactSummary(title, querySections),
    sections: querySections,
    entries
  };
}

function buildArtifactSummary(title: string, sections: QuerySectionSummary[]): string {
  const lines = [title];
  for (const section of sections) {
    lines.push(`${section.heading}: ${section.preview.slice(0, 3).join(" | ")}`.trim());
  }
  return lines.join("\n");
}

function buildSectionPreview(section: ParsedSection): string[] {
  if (section.table) {
    return section.table.rows.slice(0, 5).map((row) => row.map((cell) => cell.lines[0] ?? cell.text).join(" | "));
  }
  if (section.preformatted) {
    return splitPreviewLines(section.preformatted, 5);
  }
  return splitPreviewLines(section.text, 5);
}

function parseHotspotTable(table: ParsedTable | null | undefined): HotspotEntry[] {
  if (!table) {
    return [];
  }
  const results: HotspotEntry[] = [];
  for (const row of table.rows) {
    const labelCell = row[0];
    const label = extractPrimaryLabel(labelCell);
    if (!label || /^Total:/i.test(label)) {
      continue;
    }
    results.push({
      label,
      object_id: labelCell?.objectId ?? null,
      object_count: null,
      shallow_heap_bytes: parseCellNumber(row[1]),
      retained_heap_bytes: parseCellNumber(row[2]),
      retained_percent: null
    });
  }
  return results;
}

function parseDominatorTable(table: ParsedTable | null | undefined): HotspotEntry[] {
  if (!table) {
    return [];
  }
  const results: HotspotEntry[] = [];
  for (const row of table.rows) {
    const labelCell = row[0];
    const label = extractPrimaryLabel(labelCell);
    if (!label || /^Total:/i.test(label)) {
      continue;
    }
    results.push({
      label,
      object_id: labelCell?.objectId ?? null,
      object_count: parseCellNumber(row[1]),
      shallow_heap_bytes: parseCellNumber(row[2]),
      retained_heap_bytes: parseCellNumber(row[3]),
      retained_percent: parseCellNumber(row[4])
    });
  }
  return results;
}

function parsePackageTable(table: ParsedTable | null | undefined): HotspotEntry[] {
  if (!table) {
    return [];
  }
  const results: HotspotEntry[] = [];
  for (const row of table.rows) {
    const label = extractPrimaryLabel(row[0]);
    if (!label || /^Total:/i.test(label) || label === "<all>") {
      continue;
    }
    results.push({
      label,
      object_id: row[0]?.objectId ?? null,
      object_count: parseCellNumber(row[3]),
      shallow_heap_bytes: null,
      retained_heap_bytes: parseCellNumber(row[1]),
      retained_percent: parseCellNumber(row[2])
    });
  }
  return results;
}

function parseHistogramTable(table: ParsedTable | null | undefined): HistogramEntry[] {
  if (!table) {
    return [];
  }
  const results: HistogramEntry[] = [];
  for (const row of table.rows) {
    const label = extractPrimaryLabel(row[0]);
    if (!label || /^Total:/i.test(label)) {
      continue;
    }
    results.push({
      label,
      object_id: row[0]?.objectId ?? null,
      object_count: parseCellNumber(row[1]),
      shallow_heap_bytes: parseCellNumber(row[2]),
      retained_heap_bytes: parseCellNumber(row[3]),
      retained_percent: null
    });
  }
  return results;
}

export function parseCompareDeltaRows(artifact: ParsedHtmlArtifact): CompareDeltaEntry[] {
  const section = artifact.sections.find((item) => /Histogram comparison$/i.test(item.heading));
  if (!section || section.table_headers.length === 0) {
    return [];
  }
  return section.rows
    .filter((row) => row.length > 0 && !/^Total:/i.test(row[0] ?? ""))
    .map((row) => {
      const parts = row.map((item) => item.trim());
      return {
        label: parts[0] ?? "",
        object_count_delta: parseNumericValue(parts[1] ?? ""),
        shallow_heap_delta_bytes: parseNumericValue(parts[2] ?? ""),
        note: null
      };
    })
    .filter((item) => item.label.length > 0);
}

export function buildArtifacts(paths: Array<{ kind: AnalysisArtifact["kind"]; path: string | null | undefined }>): AnalysisArtifact[] {
  return paths
    .filter((item): item is { kind: AnalysisArtifact["kind"]; path: string } => Boolean(item.path))
    .map((item) => ({
      kind: item.kind,
      path: path.resolve(item.path)
    }));
}

function parseAccumulationPath(table: ParsedTable | null | undefined): LeakAccumulationStep[] {
  if (!table) {
    return [];
  }
  return table.rows
    .map((row) => {
      const labelCell = row[0];
      const label = extractPrimaryLabel(labelCell);
      if (!label) {
        return null;
      }
      return {
        label,
        reference_label: labelCell?.firstStrongText ?? null,
        object_id: labelCell?.objectId ?? null,
        shallow_heap_bytes: parseCellNumber(row[row.length - 2]),
        retained_heap_bytes: parseCellNumber(row[row.length - 1])
      };
    })
    .filter((item): item is LeakAccumulationStep => item !== null && !/^Total:/i.test(item.label));
}

function parseDescriptionRetained(descriptionText: string): { bytes: number | null; percent: number | null } {
  const directMatch = /total size\s+([\d,]+)\s+\(([\d.]+)%\)\s+bytes/i.exec(descriptionText)
    ?? /occup(?:y|ies)\s+([\d,]+)\s+\(([\d.]+)%\)\s+bytes/i.exec(descriptionText);
  if (!directMatch) {
    return { bytes: null, percent: null };
  }
  return {
    bytes: parseNumericValue(directMatch[1]),
    percent: parseNumericValue(directMatch[2])
  };
}

function extractKeywords(sectionHtml: string): string[] {
  const match = /<ul\b[^>]*title="Keywords"[^>]*>([\s\S]*?)<\/ul>/i.exec(sectionHtml);
  if (!match) {
    return [];
  }
  return Array.from(match[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
    .map((item) => normalizeHtmlText(item[1]))
    .filter((item) => item.length > 0);
}

function extractThreadName(descriptionText: string, stackText: string | null): string | null {
  const descriptionMatch = /The thread\s+(.+?)\s+keeps local variables/i.exec(descriptionText);
  if (descriptionMatch) {
    return descriptionMatch[1].trim();
  }
  const stackLine = firstNonEmptyLine(stackText ?? "");
  return stackLine ?? null;
}

function extractPrimaryLabel(cell: ParsedCell | undefined): string | null {
  if (!cell) {
    return null;
  }
  const firstLine = cell.lines.find((line) => !/^(Only object|All objects|First \d+ of \d+ objects)$/i.test(line));
  const primary = firstLine ?? cell.firstLinkText ?? cell.lines[0] ?? cell.text;
  if (!primary) {
    return null;
  }
  return stripTreePrefix(primary.replace(/\s+(Only object|All objects|First \d+ of \d+ objects)$/i, "").trim());
}

function parseCellNumber(cell: ParsedCell | undefined): number | null {
  if (!cell) {
    return null;
  }
  return parseNumericValue(cell.lines[0] ?? cell.text);
}

function splitPreviewLines(text: string, previewLines: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, previewLines);
}

function findHrefByText(links: Array<{ href: string; text: string }>, pattern: RegExp): string {
  const link = links.find((item) => pattern.test(item.text));
  if (!link) {
    throw new Error(`Unable to resolve report page for ${pattern}`);
  }
  return link.href;
}

function normalizeHrefToPath(href: string | undefined): string {
  if (!href || href.length === 0) {
    throw new Error("Artifact href is missing.");
  }
  return href.split("#")[0];
}

function readRequiredEntry(source: ArtifactSource, relativePath: string): string {
  const value = source.readText(relativePath);
  if (value === null) {
    throw new Error(`Artifact entry is missing: ${relativePath}`);
  }
  return value;
}

function readRequiredFile(targetPath: string): string {
  return readRequiredEntry(openArtifactSource(path.dirname(targetPath)), path.basename(targetPath));
}

function firstNonEmptyLine(text: string): string | null {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;
}

function safeStat(targetPath: string) {
  try {
    return path.resolve(targetPath) ? fs.statSync(targetPath) : null;
  } catch {
    return null;
  }
}
