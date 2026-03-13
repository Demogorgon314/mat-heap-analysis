import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasWriteAccessNearHeap } from "./pathGuard.js";

export interface PreparedHeapPath {
  sourceHeapPath: string;
  executionHeapPath: string;
  staged: boolean;
}

export function prepareHeapForExecution(heapPath: string, matDataDir: string): PreparedHeapPath {
  if (hasWriteAccessNearHeap(heapPath)) {
    return {
      sourceHeapPath: heapPath,
      executionHeapPath: heapPath,
      staged: false
    };
  }

  const stat = fs.statSync(heapPath);
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${heapPath}:${stat.size}:${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 16);

  const heapFileName = path.basename(heapPath);
  const stageRoot = path.join(matDataDir, "staged-heaps", `${path.parse(heapFileName).name}-${fingerprint}`);
  const stagedHeapPath = path.join(stageRoot, heapFileName);
  const markerPath = path.join(stageRoot, ".source.json");

  if (!isFreshStage(stagedHeapPath, stat)) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.mkdirSync(stageRoot, { recursive: true });
    fs.copyFileSync(heapPath, stagedHeapPath);
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          source_heap_path: heapPath,
          size: stat.size,
          mtime_ms: stat.mtimeMs
        },
        null,
        2
      )
    );
  }

  return {
    sourceHeapPath: heapPath,
    executionHeapPath: stagedHeapPath,
    staged: true
  };
}

function isFreshStage(stagedHeapPath: string, sourceStat: fs.Stats): boolean {
  if (!fs.existsSync(stagedHeapPath)) {
    return false;
  }

  try {
    const stagedStat = fs.statSync(stagedHeapPath);
    return stagedStat.size === sourceStat.size;
  } catch {
    return false;
  }
}
