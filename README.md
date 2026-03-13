# mat-heap-analysis

Portable Eclipse MAT heap analysis for local CLI use, Codex skills, and other agent tools such as Claude and OpenCode.

`mat-heap-analysis` gives you one MAT runtime with two layers:

- A local CLI for human use and automation
- A packaged integration surface for agent tools

The goal is simple: make Eclipse MAT usable from scripts and agents without rebuilding MAT workflows for every host tool.

## What you get

- A local `mat` CLI with focused low-level and high-level commands: `doctor`, `index`, `report`, `run`, `query`, `catalog`, `triage`, `inspect-object`, `compare`, `show-artifact`
- Stable `--json` output for agents and scripts
- Progressive help via `mat`, `mat <command> --help`, and `mat catalog --json`
- An installable skill in `skills/mat-heap-analysis`
- A bundled runtime for the skill, so end users do not need to clone this repo or run `npm install`

## Install The Skill

One-line global installs:

```bash
npx skills add https://github.com/Demogorgon314/mat-heap-analysis/tree/main/skills/mat-heap-analysis -g -a codex
npx skills add https://github.com/Demogorgon314/mat-heap-analysis/tree/main/skills/mat-heap-analysis -g -a claude-code
npx skills add https://github.com/Demogorgon314/mat-heap-analysis/tree/main/skills/mat-heap-analysis -g -a opencode
```

The installable skill lives at:

- `skills/mat-heap-analysis`

The bundled runtime used by the skill lives at:

- `skills/mat-heap-analysis/assets/runtime/mat.cjs`

User-facing skill launchers:

```bash
node skills/mat-heap-analysis/scripts/mat.cjs
skills/mat-heap-analysis/scripts/mat
```

If you are maintaining this repo and want to rebuild the packaged skill runtime:

```bash
npm run build:skill
```

## Defaults That Make Local Use Easier

- On macOS, `MAT_HOME` is auto-detected as `/Applications/MemoryAnalyzer.app/Contents/Eclipse` when present
- If you pass `--heap` and do not configure `MAT_ALLOWED_ROOTS` or `--allowed-root`, the CLI automatically trusts the heap's parent directory
- If MAT cannot write near the source heap, the CLI stages the heap into a writable workspace before running reports and queries

These defaults mean the happy path on macOS is usually just: point the CLI at a heap dump and start analyzing.

## Prerequisites

- `node`
- Java
- Eclipse MAT

If you are not on macOS, or MAT is installed somewhere custom, pass `--mat-home <dir>` or set `MAT_HOME`.

## Quick Start

Build the local CLI:

```bash
npm install
npm run build
```

Validate the environment:

```bash
node dist/cli.js doctor
```

If MAT is not installed at the default macOS location, use:

```bash
node dist/cli.js doctor --mat-home /path/to/MemoryAnalyzer
```

Run a first analysis pass on a heap dump:

```bash
node dist/cli.js triage --heap ./heap.hprof
```

Follow up with targeted analysis:

```bash
node dist/cli.js inspect-object --heap ./heap.hprof --object-id 0x12345678
node dist/cli.js compare --heap ./new.hprof --baseline ./old.hprof
node dist/cli.js show-artifact ./heap_Leak_Suspects.zip
```

Discover capabilities:

```bash
node dist/cli.js
node dist/cli.js catalog commands --json
node dist/cli.js query --help
```

## Command Model

- `doctor`: validate Java and MAT launcher resolution
- `index`: check whether MAT index artifacts already exist
- `report`: run a predefined MAT report such as `overview` or `suspects`
- `run`: run a named MAT analysis command such as `histogram` or `path2gc`
- `query`: run a single OQL query
- `triage`: run first-pass hotspot and leak-suspect analysis
- `inspect-object`: trace one object through GC roots and dominators
- `compare`: compare two heaps and summarize histogram deltas
- `show-artifact`: preview generated report/query artifacts without shelling out to `unzip`
- `catalog`: expose a machine-readable command and capability directory

Use `--json` when another tool or follow-up step will parse the result.

## CLI Examples

Basic usage:

```bash
node dist/cli.js triage --heap ./heap.hprof --json
node dist/cli.js inspect-object --heap ./heap.hprof --object-id 0xc2300098
node dist/cli.js show-artifact ./heap_Query.zip --entry index.html
node dist/cli.js catalog reports --json
```

When analyzing heaps across multiple directories, or using path-based report options such as `baseline`, add explicit allow roots:

```bash
node dist/cli.js compare \
  --heap ./new.hprof \
  --baseline ./old.hprof \
  --allowed-root .
```

## Release And Validation

Run the full release pipeline:

```bash
npm run release:skill
```

This runs:

- `build`
- `build:skill`
- `test`
- `check:skill`

Optional extra validation for the Codex skill:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/mat-heap-analysis
```

If that validator fails with `ModuleNotFoundError: No module named 'yaml'`, install `PyYAML` and rerun it.

## Repository Layout

- `src/`: TypeScript CLI and MAT execution core
- `test/`: CLI and service tests
- `skills/mat-heap-analysis/`: installable skill package
- `scripts/`: build and release helpers

## Notes

- The CLI is local-first: it shells out to a locally installed Eclipse MAT
- The installable skill is a thin wrapper around the same local runtime
- For single-heap workflows on macOS, the default configuration should usually be enough
