import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { AnalysisService } from "../src/core/analysisService.js";
import type { RunCommand } from "../src/types.js";
import { setupRuntime, successRunResult } from "./helpers.js";

test("AnalysisService triage returns structured hotspots and suspects", async () => {
  const { heap, config } = setupRuntime();
  const service = new AnalysisService(config, {
    runCommand: async (command) => {
      const executionHeapPath = findExecutionHeapPath(command);
      const reportId = command.args.at(-1);
      if (reportId === "org.eclipse.mat.api:overview") {
        writeOverviewArtifacts(executionHeapPath);
      } else if (reportId === "org.eclipse.mat.api:suspects") {
        writeSuspectsArtifacts(executionHeapPath);
      } else if (getCommandText(command).startsWith("histogram")) {
        writeHistogramQueryArtifacts(executionHeapPath);
      }
      return successRunResult(command);
    }
  });

  const result = await service.triage({ heap_path: heap, top: 5 });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.match(result.summary, /Problem Suspect 1|Largest retained object/);
    assert.equal(result.hotspots[0]?.label, "example.TopObject @ 0xc1");
    assert.equal(result.suspects[0]?.object_id, "0xc20");
    assert.match(result.next_steps[0] ?? "", /inspect-object/);
    assert.match(result.workspace_dir, /analysis-runs/);
  }
});

test("AnalysisService inspectObject summarizes GC root path and dominators", async () => {
  const { heap, config } = setupRuntime();
  const service = new AnalysisService(config, {
    runCommand: async (command) => {
      const executionHeapPath = findExecutionHeapPath(command);
      const commandText = getCommandText(command);
      if (commandText.startsWith("path2gc")) {
        writeQueryArtifacts(executionHeapPath, [
          ["Class Name", "Shallow Heap", "Retained Heap"],
          ["java.lang.String @ 0xc2300098", "24", "48"],
          ["name java.lang.ThreadGroup @ 0xc23000b0", "48", "96"]
        ]);
      } else if (commandText.startsWith("show_dominator_tree")) {
        writeQueryArtifacts(executionHeapPath, [
          ["Class Name", "Shallow Heap", "Retained Heap", "Percentage"],
          ["example.RootHolder @ 0xc300", "64", "4,096", "12.5%"]
        ]);
      } else if (commandText.startsWith("show_retained_set")) {
        writeQueryArtifacts(executionHeapPath, [
          ["Class Name", "Objects", "Shallow Heap", "Retained Heap"],
          ["byte[]", "3", "3,072", "3,072"]
        ]);
      }
      return successRunResult(command);
    }
  });

  const result = await service.inspectObject({ heap_path: heap, object_id: "0xc2300098" });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.gc_root_path[0]?.object_id, "0xc2300098");
    assert.equal(result.dominators[0]?.label, "example.RootHolder @ 0xc300");
    assert.equal(result.retained_objects[0]?.label, "byte[]");
  }
});

test("AnalysisService compare parses histogram deltas from compare report", async () => {
  const { heap, config } = setupRuntime();
  const baselineRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mat-baseline-"));
  const baselineHeap = path.join(baselineRoot, "baseline.hprof");
  fs.writeFileSync(baselineHeap, "baseline");

  const service = new AnalysisService(
    {
      ...config,
      allowedRoots: [...config.allowedRoots, fs.realpathSync(baselineRoot)]
    },
    {
      runCommand: async (command) => {
        const executionHeapPath = findExecutionHeapPath(command);
        writeCompareArtifacts(executionHeapPath);
        return successRunResult(command);
      }
    }
  );

  const result = await service.compare({ heap_path: heap, baseline_heap_path: baselineHeap, top: 5 });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.histogram_delta[0]?.label, "example.CacheEntry");
    assert.equal(result.histogram_delta[0]?.object_count_delta, 12);
    assert.match(result.summary, /example.CacheEntry/);
  }
});

test("AnalysisService showArtifact previews zip entries", () => {
  const { config } = setupRuntime();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mat-artifact-service-"));
  const zipPath = path.join(root, "artifact.zip");
  const zip = new AdmZip();
  zip.addFile("index.html", Buffer.from("<html><head><title>Artifact</title></head><body><h5>Query Command</h5><div><pre>line 1\nline 2</pre></div></body></html>", "utf8"));
  zip.writeZip(zipPath);

  const service = new AnalysisService(config);
  const result = service.showArtifact({ artifact_path: zipPath, entry: "index.html" });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.selected_entry, "index.html");
    assert.match(result.preview.join("\n"), /Artifact/);
  }
});

function findExecutionHeapPath(command: RunCommand): string {
  return command.args.find((arg) => arg.endsWith(".hprof")) ?? "";
}

function getCommandText(command: RunCommand): string {
  return command.args.find((arg) => arg.startsWith("-command="))?.slice("-command=".length) ?? "";
}

function writeOverviewArtifacts(executionHeapPath: string): void {
  const stem = path.parse(executionHeapPath).name;
  const reportDir = path.join(path.dirname(executionHeapPath), `${stem}_System_Overview`);
  const pagesDir = path.join(reportDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, "toc.html"),
    '<html><body><a href="pages/Top_Consumers5.html#i5">Top Consumers</a><a href="pages/Class_Histogram6.html#i6">Class Histogram</a></body></html>'
  );
  fs.writeFileSync(
    path.join(pagesDir, "Top_Consumers5.html"),
    [
      "<html><head><title>Top Consumers</title></head><body>",
      '<h5>Biggest Objects</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody><tr><td><a href="mat://object/0xc1">example.TopObject @ 0xc1</a></td><td>128</td><td>4,194,304</td></tr></tbody></table></div>',
      '<h5>Biggest Top-Level Dominator Classes</h5><div><table class="result"><thead><tr><th>Label</th><th>Number of Objects</th><th>Used Heap Size</th><th>Retained Heap Size</th><th>Retained Heap, %</th></tr></thead><tbody><tr><td><a href="mat://object/0xc2">example.Cache</a></td><td>5</td><td>640</td><td>5,242,880</td><td>21.00%</td></tr></tbody></table></div>',
      '<h5>Biggest Top-Level Dominator Packages</h5><div><table class="result"><thead><tr><th>Package</th><th>Retained Heap</th><th>Retained Heap, %</th><th># Top Dominators</th></tr></thead><tbody><tr><td>example.cache</td><td>5,242,880</td><td>21.00%</td><td>5</td></tr></tbody></table></div>',
      "</body></html>"
    ].join("")
  );
  fs.writeFileSync(
    path.join(pagesDir, "Class_Histogram6.html"),
    '<html><head><title>Class Histogram</title></head><body><h5>Class Histogram</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Objects</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody><tr><td><a href="mat://object/0xc3">byte[]</a></td><td>10</td><td>2,048</td><td>8,388,608</td></tr></tbody></table></div></body></html>'
  );
}

function writeSuspectsArtifacts(executionHeapPath: string): void {
  const stem = path.parse(executionHeapPath).name;
  const reportDir = path.join(path.dirname(executionHeapPath), `${stem}_Leak_Suspects`);
  const pagesDir = path.join(reportDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "toc.html"), "<html><head><title>Leak Suspects</title></head><body></body></html>");
  fs.writeFileSync(
    path.join(pagesDir, "19.html"),
    [
      "<html><head><title>Problem Suspect 1</title></head><body>",
      '<h5>Description</h5><div><p>The thread <strong>example.Worker @ 0xc10 worker-1</strong> keeps local variables with total size <strong>134,217,728 (52.00%)</strong> bytes.</p><p><strong>Keywords</strong></p><ul title="Keywords"><li>byte[]</li></ul></div>',
      '<h5>Shortest Paths To the Accumulation Point</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody><tr><td><a href="mat://object/0xc20">byte[1024] @ 0xc20</a></td><td>1024</td><td>1024</td></tr></tbody></table></div>',
      '<h5>All Accumulated Objects by Class</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Objects</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody><tr><td><a href="mat://object/0xc22">byte[]</a></td><td>1</td><td>1,024</td><td>1,024</td></tr></tbody></table></div>',
      "</body></html>"
    ].join("")
  );
}

function writeHistogramQueryArtifacts(executionHeapPath: string): void {
  writeQueryArtifacts(executionHeapPath, [
    ["Class Name", "Objects", "Shallow Heap", "Retained Heap"],
    ["byte[]", "10", "2,048", "8,388,608"]
  ]);
}

function writeCompareArtifacts(executionHeapPath: string): void {
  const stem = path.parse(executionHeapPath).name;
  const reportDir = path.join(path.dirname(executionHeapPath), `${stem}_Comparison`);
  const pagesDir = path.join(reportDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "toc.html"), '<html><body><a href="index.html#i2">Histogram comparison</a></body></html>');
  fs.writeFileSync(
    path.join(reportDir, "index.html"),
    [
      "<html><head><title>Histogram Comparison</title></head><body>",
      '<h5>Histogram comparison</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Objects</th><th>Shallow Heap</th></tr></thead><tbody>',
      '<tr><td><a href="mat://object/0xc90">example.CacheEntry</a></td><td>+12</td><td>+24,576</td></tr>',
      '</tbody></table></div>',
      '<h5><a href="pages/Histogram_comparison3.csv">Histogram comparison as CSV file</a></h5>',
      "</body></html>"
    ].join("")
  );
  fs.writeFileSync(path.join(pagesDir, "Histogram_comparison3.csv"), "Class Name,Objects,Shallow Heap\nexample.CacheEntry,+12,+24576\n");
}

function writeQueryArtifacts(executionHeapPath: string, rows: string[][]): void {
  const stem = path.parse(executionHeapPath).name;
  const queryDir = path.join(path.dirname(executionHeapPath), `${stem}_Query`);
  const pagesDir = path.join(queryDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });
  const [headers, ...body] = rows;
  const headerHtml = headers.map((value) => `<th>${value}</th>`).join("");
  const rowHtml = body
    .map((row, index) => {
      const objectId = /@\s+(0x[0-9a-fA-F]+)/.exec(row[0])?.[1] ?? `0xc${index + 1}`;
      const firstCell = index === 0
        ? `<td><a href="mat://object/${objectId}">${row[0]}</a></td>`
        : `<td><a href="mat://object/${objectId}">${row[0]}</a></td>`;
      return `<tr>${[firstCell, ...row.slice(1).map((cell) => `<td>${cell}</td>`)].join("")}</tr>`;
    })
    .join("");
  fs.writeFileSync(path.join(queryDir, "toc.html"), '<html><body><a href="index.html#i2">Query Command</a></body></html>');
  fs.writeFileSync(
    path.join(queryDir, "index.html"),
    `<html><head><title>Single Query</title></head><body><h1>Single Query</h1><h5>Query Command</h5><div><table class="result"><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table></div></body></html>`
  );
  fs.writeFileSync(path.join(pagesDir, "Query_Command2.txt"), body.map((row) => row.join(" | ")).join("\n"));
}
