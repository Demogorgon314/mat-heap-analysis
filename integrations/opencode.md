# OpenCode Integration

Use the bundled MAT launcher as a local tool/command in OpenCode-style environments.

## Runtime

Point the tool wrapper at:

```bash
node scripts/mat.cjs
```

## Prompt

Use:

- `integrations/MAT_AGENT_PROMPT.md`

## Recommended discovery flow

```bash
node scripts/mat.cjs
node scripts/mat.cjs catalog --json
node scripts/mat.cjs run --help
```

## Recommended usage pattern

- Use `catalog --json` for machine-readable capability discovery.
- Use `doctor` to validate Java and MAT before heavy analysis.
- Use `report` for first-pass triage.
- Use `run` and `query` for focused follow-up analysis.

## Portability note

Treat this repo as a portable `mat-heap-analysis` runtime, not an OpenCode-only plugin. The wrapper should stay minimal and defer all MAT behavior to the bundled runtime.
