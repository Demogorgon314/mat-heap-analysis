---
name: mat-heap-analysis
description: Use when the user wants to inspect a Java heap dump with Eclipse MAT through a local CLI, including leak suspects reports, overview reports, OQL queries, histogram analysis, path-to-gc-roots checks, and index inspection.
---

# MAT Heap Analysis

## Overview

Use the bundled launcher in `scripts/mat.cjs` to analyze `.hprof` and other MAT-supported heap dumps without depending on a separate checked-out repo.

Start with `doctor` if MAT or Java may be misconfigured. For first-pass triage, prefer `index`, `report org.eclipse.mat.api:overview`, and `report org.eclipse.mat.api:suspects`. Use `run` and `query` for targeted follow-up analysis.

## Runtime Defaults

- Use `node scripts/mat.cjs` as the portable entrypoint.
- On macOS, `doctor` auto-detects MAT at `/Applications/MemoryAnalyzer.app/Contents/Eclipse` when installed there.
- When `--heap` is present and no allowlist is configured, the CLI automatically trusts the heap's parent directory.
- When MAT cannot write near the source heap, the CLI stages the heap into a writable workspace before running reports and queries.
- Add `--allowed-root` only when the workflow spans multiple directories, such as `compare` reports or heaps outside the main heap directory.

## Quick Start

Use the bundled launcher:

`node scripts/mat.cjs`

Common first commands:

```bash
node scripts/mat.cjs doctor
node scripts/mat.cjs index --heap ./heap.hprof
node scripts/mat.cjs report org.eclipse.mat.api:overview --heap ./heap.hprof
node scripts/mat.cjs report org.eclipse.mat.api:suspects --heap ./heap.hprof
node scripts/mat.cjs run histogram --heap ./heap.hprof --json
node scripts/mat.cjs query --heap ./heap.hprof --query 'SELECT s FROM INSTANCEOF java.lang.String s' --json
```

## Workflow

1. Run `node scripts/mat.cjs doctor` if MAT launcher or Java is unknown.
2. Run `node scripts/mat.cjs catalog --json` or `node scripts/mat.cjs <command> --help` for capability discovery.
3. For a new heap, prefer:
   - `node scripts/mat.cjs index`
   - `node scripts/mat.cjs report org.eclipse.mat.api:overview`
   - `node scripts/mat.cjs report org.eclipse.mat.api:suspects`
4. For focused analysis, use:
   - `node scripts/mat.cjs run histogram`
   - `node scripts/mat.cjs run path2gc --args 0x...`
   - `node scripts/mat.cjs query --query 'SELECT ...'`
5. Prefer `--json` when a later step will parse the result.
6. Avoid running multiple `run` and `query` commands against the same heap in parallel when the output artifacts matter; MAT reuses the same query output directory.
7. On failure, use the returned `Hint`, `stderr`, and exit code rather than guessing.

## Installation Expectations

- The skill bundles a ready-to-run Node launcher in `assets/runtime/mat.cjs`.
- Use `node scripts/mat.cjs ...` as the cross-platform entrypoint.
- The only external prerequisites are `node`, Java, and an Eclipse MAT installation.
- Prefer defaults for single-heap local analysis.
- Configure MAT with `--mat-home` or `MAT_HOME` only when MAT is not installed in the default location.
- Configure `--allowed-root` or `MAT_ALLOWED_ROOTS` only when the analysis spans additional directories.

## References

Read `references/commands.md` for command examples, compare-mode usage, and common recovery patterns.
