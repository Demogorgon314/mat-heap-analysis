# MAT Heap Analysis Commands

Use these examples with the bundled entrypoint:

```bash
node scripts/mat.cjs
```

For a single heap in one directory, you usually do not need `--allowed-root`. Add it only when the workflow spans more than the main heap directory.

## Environment check

```bash
node scripts/mat.cjs doctor
node scripts/mat.cjs doctor --mat-home /custom/MemoryAnalyzer
```

## First-pass triage

```bash
node scripts/mat.cjs index --heap ./heap.hprof
node scripts/mat.cjs report org.eclipse.mat.api:overview --heap ./heap.hprof
node scripts/mat.cjs report org.eclipse.mat.api:suspects --heap ./heap.hprof
```

## Targeted commands

```bash
node scripts/mat.cjs run histogram --heap ./heap.hprof
node scripts/mat.cjs run thread_overview --heap ./heap.hprof
node scripts/mat.cjs run path2gc --heap ./heap.hprof --args 0x12345678
```

## OQL

```bash
node scripts/mat.cjs query --heap ./heap.hprof --query 'SELECT s FROM INSTANCEOF java.lang.String s'
node scripts/mat.cjs query --heap ./heap.hprof --query-file ./query.oql --json
```

## Multi-directory and compare workflows

```bash
node scripts/mat.cjs report org.eclipse.mat.api:compare \
  --heap ./new.hprof \
  --option baseline=../baseline/old.hprof \
  --allowed-root . \
  --allowed-root ../baseline
```

## Capability discovery

```bash
node scripts/mat.cjs
node scripts/mat.cjs query --help
node scripts/mat.cjs catalog
node scripts/mat.cjs catalog commands --json
node scripts/mat.cjs catalog oql
```

## Common error recovery

- `MAT_NOT_FOUND`: run `node scripts/mat.cjs doctor --mat-home ...`
- `HEAP_NOT_FOUND`: fix `--heap` or widen `--allowed-root` for extra heap directories
- `WRITE_PERMISSION_DENIED`: the CLI now stages the heap automatically for report/query/run; if this still appears, inspect filesystem permissions and MAT stderr
- `INVALID_QUERY`: use `node scripts/mat.cjs catalog oql`

## Concurrency note

- Prefer sequential `run` and `query` commands on the same heap when you care about the generated query artifacts. MAT reuses the same query output directory.
