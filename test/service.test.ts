import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { MatService } from "../src/core/service.js";
import { setupRuntime, successRunResult } from "./helpers.js";

test("parseReport returns generated artifacts when run succeeds", async () => {
  const { root, heap, config } = setupRuntime();
  const reportDir = path.join(root, "heap_Leak_Suspects");
  const reportZip = path.join(root, "heap_Leak_Suspects.zip");

  const service = new MatService(config, {
    runCommand: async (command) => {
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(reportZip, "zip");
      return successRunResult(command);
    }
  });

  const result = await service.parseReport({
    heap_path: heap,
    report_id: "org.eclipse.mat.api:suspects"
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.report_dir, reportDir);
    assert.equal(result.report_zip, reportZip);
  }
});

test("oqlQuery returns INVALID_QUERY on syntax failure", async () => {
  const { heap, config } = setupRuntime();
  const service = new MatService(config, {
    runCommand: async (command) =>
      successRunResult(command, {
        exitCode: 1,
        stderr: "OQL parse error: invalid query"
      })
  });

  const result = await service.oqlQuery({
    heap_path: heap,
    oql: "select from"
  });

  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.category, "INVALID_QUERY");
  }
});

test("runCommand returns artifacts on success", async () => {
  const { root, heap, config } = setupRuntime();
  const queryDir = path.join(root, "heap_Query");
  const pagesDir = path.join(queryDir, "pages");

  const service = new MatService(config, {
    runCommand: async (command) => {
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, "Query_Command1.txt"), "line 1\nline 2\n");
      return successRunResult(command);
    }
  });

  const result = await service.runCommand({
    heap_path: heap,
    command_name: "histogram"
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.command_name, "histogram");
    assert.equal(result.query_dir, queryDir);
    assert.ok(result.result_txt?.includes("Query_Command1.txt"));
    assert.deepEqual(result.result_preview, ["line 1", "line 2"]);
  }
});

test("indexStatus returns metadata", () => {
  const { root, heap, config } = setupRuntime();
  fs.writeFileSync(path.join(root, "heap.hprof.index"), "idx");
  fs.writeFileSync(path.join(root, "heap.hprof.threads"), "th");

  const service = new MatService(config);
  const result = service.indexStatus({ heap_path: heap });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.index_present, true);
    assert.ok(result.index_files.length >= 1);
    assert.ok(result.threads_file?.endsWith(".threads"));
  }
});

test("parseReport stages heap to writable workspace when source directory is not writable", async () => {
  const { root, heap, config } = setupRuntime();
  const originalMode = fs.statSync(root).mode & 0o777;
  fs.chmodSync(root, 0o555);

  try {
    let executionHeapPath = "";
    const service = new MatService(config, {
      runCommand: async (command) => {
        executionHeapPath = command.args.find((arg) => arg.endsWith(".hprof")) ?? "";
        const reportDir = path.join(path.dirname(executionHeapPath), "heap_Leak_Suspects");
        const reportZip = path.join(path.dirname(executionHeapPath), "heap_Leak_Suspects.zip");
        fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(reportZip, "zip");
        return successRunResult(command);
      }
    });

    const result = await service.parseReport({
      heap_path: heap,
      report_id: "org.eclipse.mat.api:suspects"
    });

    assert.equal(result.status, "ok");
    assert.notEqual(executionHeapPath, heap);
    assert.match(executionHeapPath, /staged-heaps/);
    if (result.status === "ok") {
      assert.match(result.report_dir ?? "", /staged-heaps/);
      assert.match(result.report_zip ?? "", /staged-heaps/);
    }
  } finally {
    fs.chmodSync(root, originalMode);
  }
});
