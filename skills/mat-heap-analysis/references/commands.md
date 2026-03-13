# MAT Heap Analysis Commands

Resolve these examples relative to the directory that contains the current `SKILL.md`.

Let `skill_dir` be that directory. Prefer the self-locating wrapper:

```bash
"$skill_dir/scripts/mat"
```

Do not assume `scripts/mat.cjs` is relative to the user repo's current working directory.

For a single heap in one directory, you usually do not need `--allowed-root`. Add it only when the workflow spans more than the main heap directory.

## Environment check

```bash
"$skill_dir/scripts/mat" doctor
"$skill_dir/scripts/mat" doctor --mat-home /custom/MemoryAnalyzer
```

## First-pass triage

```bash
"$skill_dir/scripts/mat" triage --heap ./heap.hprof
"$skill_dir/scripts/mat" triage --heap ./heap.hprof --top 5 --json
```

## Targeted commands

```bash
"$skill_dir/scripts/mat" inspect-object --heap ./heap.hprof --object-id 0x12345678
"$skill_dir/scripts/mat" show-artifact ./heap_Leak_Suspects.zip
"$skill_dir/scripts/mat" run histogram --heap ./heap.hprof
"$skill_dir/scripts/mat" run thread_overview --heap ./heap.hprof
"$skill_dir/scripts/mat" run path2gc --heap ./heap.hprof --args 0x12345678
```

## OQL

```bash
"$skill_dir/scripts/mat" query --heap ./heap.hprof --query 'SELECT s FROM INSTANCEOF java.lang.String s'
"$skill_dir/scripts/mat" query --heap ./heap.hprof --query-file ./query.oql --json
```

## Multi-directory and compare workflows

```bash
"$skill_dir/scripts/mat" compare \
  --heap ./new.hprof \
  --baseline ../baseline/old.hprof \
  --allowed-root . \
  --allowed-root ../baseline
```

## Capability discovery

```bash
"$skill_dir/scripts/mat"
"$skill_dir/scripts/mat" query --help
"$skill_dir/scripts/mat" catalog
"$skill_dir/scripts/mat" catalog commands --json
"$skill_dir/scripts/mat" catalog oql
```

## Common error recovery

- `MAT_NOT_FOUND`: run `"$skill_dir/scripts/mat" doctor --mat-home ...`
- `HEAP_NOT_FOUND`: fix `--heap` or widen `--allowed-root` for extra heap directories
- `WRITE_PERMISSION_DENIED`: the CLI now stages the heap automatically for report/query/run; if this still appears, inspect filesystem permissions and MAT stderr
- `INVALID_QUERY`: use `"$skill_dir/scripts/mat" catalog oql`

## Concurrency note

- High-level commands such as `triage`, `inspect-object`, and `compare` isolate their MAT workspaces automatically.
- Prefer sequential `run` and `query` commands on the same heap when you care about the generated low-level query artifacts. MAT reuses the same query output directory.
