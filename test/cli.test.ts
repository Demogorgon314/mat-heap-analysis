import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli/program.js";
import { DEFAULT_MACOS_MAT_HOME } from "../src/config.js";
import { createEnv, createIoCapture, setupRuntime, successRunResult } from "./helpers.js";

test("runCli prints top-level help with no args", async () => {
  const capture = createIoCapture();
  const exitCode = await runCli([], { io: capture.io });

  assert.equal(exitCode, 0);
  assert.match(capture.stdout(), /Agent-friendly Eclipse MAT CLI/);
  assert.match(capture.stdout(), /Commands:/);
});

test("runCli returns usage help for missing query args", async () => {
  const capture = createIoCapture();
  const exitCode = await runCli(["query"], { io: capture.io });

  assert.equal(exitCode, 2);
  assert.match(capture.stderr(), /query requires --heap <path>/);
  assert.match(capture.stderr(), /Usage:/);
  assert.match(capture.stderr(), /mat query --heap/);
});

test("runCli emits catalog json", async () => {
  const capture = createIoCapture();
  const exitCode = await runCli(["catalog", "commands", "--json"], { io: capture.io });

  assert.equal(exitCode, 0);
  const payload = JSON.parse(capture.stdout());
  assert.equal(payload.command, "catalog");
  assert.equal(payload.section, "commands");
  assert.ok(Array.isArray(payload.commands));
});

test("runCli emits query json on success", async () => {
  const { root, heap, launcher } = setupRuntime();
  const capture = createIoCapture();
  const queryDir = path.join(root, "heap_Query");
  const pagesDir = path.join(queryDir, "pages");

  const exitCode = await runCli(
    ["query", "--heap", heap, "--allowed-root", root, "--query", "SELECT x FROM INSTANCEOF java.lang.String x", "--json"],
    {
      io: capture.io,
      env: createEnv(root, launcher),
      matServiceDeps: {
        runCommand: async (command) => {
          fs.mkdirSync(pagesDir, { recursive: true });
          fs.writeFileSync(path.join(pagesDir, "Query_Command1.txt"), "hello\nworld\n");
          return successRunResult(command);
        }
      }
    }
  );

  assert.equal(exitCode, 0);
  const payload = JSON.parse(capture.stdout());
  assert.equal(payload.command, "query");
  assert.equal(payload.status, "ok");
  assert.deepEqual(payload.result_preview, ["hello", "world"]);
});

test("runCli emits triage json on success", async () => {
  const { root, heap, launcher } = setupRuntime();
  const capture = createIoCapture();

  const exitCode = await runCli(
    ["triage", "--heap", heap, "--allowed-root", root, "--json"],
    {
      io: capture.io,
      env: createEnv(root, launcher),
      matServiceDeps: {
        runCommand: async (command) => {
          const executionHeapPath = command.args.find((arg) => arg.endsWith(".hprof")) ?? "";
          const reportId = command.args.at(-1);
          if (reportId === "org.eclipse.mat.api:overview") {
            writeOverviewArtifacts(executionHeapPath);
          } else if (reportId === "org.eclipse.mat.api:suspects") {
            writeSuspectsArtifacts(executionHeapPath);
          } else if (command.args.some((arg) => arg.startsWith("-command=histogram"))) {
            writeHistogramQueryArtifacts(executionHeapPath);
          }
          return successRunResult(command);
        }
      }
    }
  );

  assert.equal(exitCode, 0);
  const payload = JSON.parse(capture.stdout());
  assert.equal(payload.command, "triage");
  assert.equal(payload.status, "ok");
  assert.equal(payload.hotspots[0].label, "example.TopObject @ 0xc1");
});

test("runCli previews artifact json", async () => {
  const { root } = setupRuntime();
  const capture = createIoCapture();
  const zipPath = path.join(root, "artifact.zip");
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip();
  zip.addFile("index.html", Buffer.from("<html><head><title>Artifact</title></head><body><h5>Query Command</h5><div><pre>line 1</pre></div></body></html>", "utf8"));
  zip.writeZip(zipPath);

  const exitCode = await runCli(["show-artifact", zipPath, "--entry", "index.html", "--json"], {
    io: capture.io
  });

  assert.equal(exitCode, 0);
  const payload = JSON.parse(capture.stdout());
  assert.equal(payload.command, "show-artifact");
  assert.equal(payload.selected_entry, "index.html");
});

test("runCli infers allowed root from --heap parent when no allowlist is configured", async () => {
  const { root, heap, launcher } = setupRuntime();
  const capture = createIoCapture();
  const queryDir = path.join(root, "heap_Query");
  const pagesDir = path.join(queryDir, "pages");

  const exitCode = await runCli(
    ["query", "--heap", heap, "--query", "SELECT x FROM INSTANCEOF java.lang.String x", "--json"],
    {
      io: capture.io,
      env: {
        MAT_LAUNCHER: launcher
      },
      matServiceDeps: {
        runCommand: async (command) => {
          fs.mkdirSync(pagesDir, { recursive: true });
          fs.writeFileSync(path.join(pagesDir, "Query_Command1.txt"), "hello\nworld\n");
          return successRunResult(command);
        }
      }
    }
  );

  assert.equal(exitCode, 0);
  const payload = JSON.parse(capture.stdout());
  assert.equal(payload.command, "query");
  assert.equal(payload.status, "ok");
  assert.deepEqual(payload.result_preview, ["hello", "world"]);
});

test("runCli returns MAT_NOT_FOUND exit code for doctor failure", async () => {
  const capture = createIoCapture();
  const originalExistsSync = fs.existsSync;
  fs.existsSync = ((targetPath: fs.PathLike) => {
    if (String(targetPath) === DEFAULT_MACOS_MAT_HOME) {
      return false;
    }
    return originalExistsSync(targetPath);
  }) as typeof fs.existsSync;

  try {
    const exitCode = await runCli(["doctor"], { io: capture.io, env: {} });

    assert.equal(exitCode, 3);
    assert.match(capture.stderr(), /MAT launcher is not configured/);
    assert.match(capture.stderr(), /\[exit:3/);
  } finally {
    fs.existsSync = originalExistsSync;
  }
});

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
    '<html><head><title>Top Consumers</title></head><body><h5>Biggest Objects</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody><tr><td><a href="mat://object/0xc1">example.TopObject @ 0xc1</a></td><td>128</td><td>4,194,304</td></tr></tbody></table></div><h5>Biggest Top-Level Dominator Classes</h5><div><table class="result"><thead><tr><th>Label</th><th>Number of Objects</th><th>Used Heap Size</th><th>Retained Heap Size</th><th>Retained Heap, %</th></tr></thead><tbody><tr><td><a href="mat://object/0xc2">example.Cache</a></td><td>5</td><td>640</td><td>5,242,880</td><td>21.00%</td></tr></tbody></table></div><h5>Biggest Top-Level Dominator Packages</h5><div><table class="result"><thead><tr><th>Package</th><th>Retained Heap</th><th>Retained Heap, %</th><th># Top Dominators</th></tr></thead><tbody><tr><td>example.cache</td><td>5,242,880</td><td>21.00%</td><td>5</td></tr></tbody></table></div></body></html>'
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
    '<html><head><title>Problem Suspect 1</title></head><body><h5>Description</h5><div><p>The thread <strong>example.Worker @ 0xc10 worker-1</strong> keeps local variables with total size <strong>134,217,728 (52.00%)</strong> bytes.</p></div><h5>Shortest Paths To the Accumulation Point</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody><tr><td><a href="mat://object/0xc20">byte[1024] @ 0xc20</a></td><td>1024</td><td>1024</td></tr></tbody></table></div><h5>All Accumulated Objects by Class</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Objects</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody><tr><td><a href="mat://object/0xc22">byte[]</a></td><td>1</td><td>1,024</td><td>1,024</td></tr></tbody></table></div></body></html>'
  );
}

function writeHistogramQueryArtifacts(executionHeapPath: string): void {
  const stem = path.parse(executionHeapPath).name;
  const queryDir = path.join(path.dirname(executionHeapPath), `${stem}_Query`);
  const pagesDir = path.join(queryDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(queryDir, "toc.html"), '<html><body><a href="index.html#i2">Query Command</a></body></html>');
  fs.writeFileSync(
    path.join(queryDir, "index.html"),
    '<html><head><title>Single Query</title></head><body><h1>Single Query</h1><h5>Query Command</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Objects</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody><tr><td><a href="mat://object/0xc3">byte[]</a></td><td>10</td><td>2,048</td><td>8,388,608</td></tr></tbody></table></div></body></html>'
  );
  fs.writeFileSync(path.join(pagesDir, "Query_Command2.txt"), "byte[] | 10 | 2048 | 8388608\n");
}
