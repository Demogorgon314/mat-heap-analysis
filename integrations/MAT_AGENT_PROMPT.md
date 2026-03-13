# MAT Heap Analysis Agent Prompt

Use this runtime when the user wants to inspect a Java heap dump with Eclipse MAT, including:

- leak suspects analysis
- heap overview reports
- OQL queries
- histogram and retained-size inspection
- path-to-gc-roots analysis
- index inspection

## Runtime

Call the local launcher:

```bash
node scripts/mat.cjs
```

## Discovery

Start with:

```bash
node scripts/mat.cjs
node scripts/mat.cjs catalog --json
node scripts/mat.cjs <command> --help
```

## Recommended workflow

1. Run `doctor` if MAT or Java may be misconfigured.
2. Run `index` to inspect existing MAT artifacts.
3. For first-pass triage, prefer:
   - `report org.eclipse.mat.api:overview`
   - `report org.eclipse.mat.api:suspects`
4. For targeted follow-up, prefer:
   - `run histogram`
   - `run path2gc --args 0x...`
   - `query --query 'SELECT ...'`
5. Prefer `--json` when a later tool step needs to parse the result.
6. Use returned `Hint`, `stderr`, and exit codes instead of blind retries.

## Environment

- The heap path must be inside an allowed root.
- Pass `--allowed-root <dir>` unless `MAT_ALLOWED_ROOTS` is already configured.
- Configure MAT with `--mat-home`, `--mat-launcher`, `MAT_HOME`, or `MAT_LAUNCHER`.

## Examples

```bash
node scripts/mat.cjs doctor --mat-home /Applications/MemoryAnalyzer.app/Contents/Eclipse
node scripts/mat.cjs index --heap ./heap.hprof --allowed-root .
node scripts/mat.cjs report org.eclipse.mat.api:suspects --heap ./heap.hprof --allowed-root .
node scripts/mat.cjs run histogram --heap ./heap.hprof --allowed-root . --json
node scripts/mat.cjs query --heap ./heap.hprof --allowed-root . --query 'SELECT s FROM INSTANCEOF java.lang.String s' --json
```
