import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { parseLeakSuspectsArtifact, parseOverviewArtifact, previewArtifact } from "../src/core/reportParser.js";

test("parseOverviewArtifact extracts hotspots, packages, and histogram rows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mat-report-parser-"));
  const pagesDir = path.join(root, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  fs.writeFileSync(
    path.join(root, "toc.html"),
    [
      "<html><body>",
      '<a href="pages/Top_Consumers5.html#i5">Top Consumers</a>',
      '<a href="pages/Class_Histogram6.html#i6">Class Histogram</a>',
      "</body></html>"
    ].join("")
  );

  fs.writeFileSync(
    path.join(pagesDir, "Top_Consumers5.html"),
    [
      "<html><head><title>Top Consumers</title></head><body>",
      '<h5>Biggest Objects</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody>',
      '<tr><td><a href="mat://object/0xc1">example.TopObject @ 0xc1</a></td><td>128</td><td>4,194,304</td></tr>',
      '</tbody></table></div>',
      '<h5>Biggest Top-Level Dominator Classes</h5><div><table class="result"><thead><tr><th>Label</th><th>Number of Objects</th><th>Used Heap Size</th><th>Retained Heap Size</th><th>Retained Heap, %</th></tr></thead><tbody>',
      '<tr><td><a href="mat://object/0xc2">example.Cache</a></td><td>5</td><td>640</td><td>5,242,880</td><td>21.00%</td></tr>',
      '</tbody></table></div>',
      '<h5>Biggest Top-Level Dominator Packages</h5><div><table class="result"><thead><tr><th>Package</th><th>Retained Heap</th><th>Retained Heap, %</th><th># Top Dominators</th></tr></thead><tbody>',
      '<tr><td>example.cache</td><td>5,242,880</td><td>21.00%</td><td>5</td></tr>',
      '</tbody></table></div>',
      "</body></html>"
    ].join("")
  );

  fs.writeFileSync(
    path.join(pagesDir, "Class_Histogram6.html"),
    [
      "<html><head><title>Class Histogram</title></head><body>",
      '<h5>Class Histogram</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Objects</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody>',
      '<tr><td><a href="mat://object/0xc3">byte[]</a></td><td>10</td><td>2,048</td><td>&gt;= 8,388,608</td></tr>',
      '</tbody></table></div>',
      "</body></html>"
    ].join("")
  );

  const parsed = parseOverviewArtifact(root);
  assert.equal(parsed.biggestObjects[0]?.label, "example.TopObject @ 0xc1");
  assert.equal(parsed.biggestObjects[0]?.object_id, "0xc1");
  assert.equal(parsed.dominatorClasses[0]?.retained_percent, 21);
  assert.equal(parsed.dominantPackages[0]?.label, "example.cache");
  assert.equal(parsed.histogram[0]?.retained_heap_bytes, 8_388_608);
});

test("parseLeakSuspectsArtifact extracts suspects, keywords, and accumulation path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mat-suspects-parser-"));
  const pagesDir = path.join(root, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  fs.writeFileSync(path.join(root, "toc.html"), "<html><head><title>Leak Suspects</title></head><body></body></html>");
  fs.writeFileSync(
    path.join(pagesDir, "19.html"),
    [
      "<html><head><title>Problem Suspect 1</title></head><body>",
      '<h5>Description</h5><div><p>The thread <strong>example.Worker @ 0xc10 worker-1</strong> keeps local variables with total size <strong>134,217,728 (52.00%)</strong> bytes.</p><p><strong>Keywords</strong></p><ul title="Keywords"><li>byte[]</li><li>example.Worker</li></ul></div>',
      '<h5>Shortest Paths To the Accumulation Point</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody>',
      '<tr><td><a href="mat://object/0xc20">byte[1024] @ 0xc20</a></td><td>1024</td><td>1024</td></tr>',
      '<tr><td><strong>buffer</strong> <a href="mat://object/0xc21">example.Buffer @ 0xc21</a></td><td>64</td><td>2,048</td></tr>',
      '</tbody></table></div>',
      '<h5>All Accumulated Objects by Class</h5><div><table class="result"><thead><tr><th>Class Name</th><th>Objects</th><th>Shallow Heap</th><th>Retained Heap</th></tr></thead><tbody>',
      '<tr><td><a href="mat://object/0xc22">byte[]</a></td><td>1</td><td>1,024</td><td>1,024</td></tr>',
      '</tbody></table></div>',
      '<h5>Thread Stack</h5><div><pre>worker-1\n  at example.Worker.run()</pre></div>',
      "</body></html>"
    ].join("")
  );

  const parsed = parseLeakSuspectsArtifact(root);
  assert.equal(parsed.suspects.length, 1);
  assert.equal(parsed.suspects[0]?.keywords[0], "byte[]");
  assert.equal(parsed.suspects[0]?.accumulation_path[0]?.object_id, "0xc20");
  assert.equal(parsed.suspects[0]?.thread_name, "example.Worker @ 0xc10 worker-1");
});

test("previewArtifact lists zip entries and previews selected html entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mat-artifact-preview-"));
  const zipPath = path.join(root, "artifact.zip");
  const zip = new AdmZip();
  zip.addFile("index.html", Buffer.from("<html><head><title>Artifact</title></head><body><h5>Query Command</h5><div><table class=\"result\"><thead><tr><th>Name</th></tr></thead><tbody><tr><td>row 1</td></tr></tbody></table></div></body></html>", "utf8"));
  zip.addFile("pages/result.txt", Buffer.from("line 1\nline 2\n", "utf8"));
  zip.writeZip(zipPath);

  const listed = previewArtifact(zipPath, undefined, 10);
  assert.equal(listed.artifact_type, "zip");
  assert.deepEqual(listed.entries, ["index.html", "pages/result.txt"]);

  const preview = previewArtifact(zipPath, "index.html", 10);
  assert.equal(preview.selected_entry, "index.html");
  assert.match(preview.preview.join("\n"), /Artifact/);
  assert.match(preview.preview.join("\n"), /Query Command/);
});
