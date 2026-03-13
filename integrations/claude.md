# Claude Integration

Use the bundled MAT launcher as a local command/tool in Claude-compatible agent environments.

## Runtime

Register a local command that executes:

```bash
node scripts/mat.cjs
```

## Prompt

Use the guidance in:

- `integrations/MAT_AGENT_PROMPT.md`

## Discovery pattern

Let Claude explore the runtime through:

```bash
node scripts/mat.cjs
node scripts/mat.cjs catalog --json
node scripts/mat.cjs <command> --help
```

## Recommended workflow

1. `doctor`
2. `index`
3. `report org.eclipse.mat.api:overview`
4. `report org.eclipse.mat.api:suspects`
5. `run histogram` / `run path2gc`
6. `query --query 'SELECT ...'`

## Portability note

Keep Claude-specific wrapping thin. Reuse the same launcher and prompt rather than copying MAT command logic into another adapter.
