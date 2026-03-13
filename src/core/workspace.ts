import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface WorkflowHeap {
  key: string;
  source_heap_path: string;
  execution_heap_path: string;
}

export interface WorkflowWorkspace {
  run_dir: string;
  heaps: Record<string, WorkflowHeap>;
}

export function createWorkflowWorkspace(
  matDataDir: string,
  heaps: Array<{ key: string; heapPath: string }>,
  options: {
    parent_dir?: string;
    label?: string;
  } = {}
): WorkflowWorkspace {
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const prefix = options.label ? `${options.label}-` : "";
  const runDirRaw = options.parent_dir
    ? path.join(options.parent_dir, `${prefix}${runId}`)
    : path.join(matDataDir, "analysis-runs", `${prefix}${runId}`);
  fs.mkdirSync(runDirRaw, { recursive: true });
  const runDir = fs.realpathSync(runDirRaw);

  const mappedHeaps: Record<string, WorkflowHeap> = {};

  for (const heap of heaps) {
    const executionHeapPath = stageHeapIntoRunDir(heap.heapPath, runDir, heap.key);
    mappedHeaps[heap.key] = {
      key: heap.key,
      source_heap_path: path.resolve(heap.heapPath),
      execution_heap_path: executionHeapPath
    };
  }

  return {
    run_dir: runDir,
    heaps: mappedHeaps
  };
}

function stageHeapIntoRunDir(heapPath: string, runDir: string, key: string): string {
  const absolute = path.resolve(heapPath);
  const fileName = path.basename(absolute);
  const stagedPath = path.join(runDir, `${key}-${fileName}`);
  fs.copyFileSync(absolute, stagedPath);
  return fs.realpathSync(stagedPath);
}
