# Cross-Agent Integration

This repo is designed so the `mat-heap-analysis` runtime works across agent tools, while the Codex skill is only one adapter.

## Portable pieces

- Pack manifest: `integrations/agent-pack.json`
- Runtime entrypoint: `skills/mat-heap-analysis/scripts/mat.cjs`
- Bundled runtime: `skills/mat-heap-analysis/assets/runtime/mat.cjs`
- Vendor-neutral prompt: `integrations/MAT_AGENT_PROMPT.md`

## Tool-specific guides

- Codex: `integrations/codex.md`
- Claude: `integrations/claude.md`
- OpenCode: `integrations/opencode.md`

## Recommended integration model

For Claude, Codex, OpenCode, and similar tools:

1. Register a local command or tool that runs:

```bash
node scripts/mat.cjs
```

2. Feed the agent the prompt from `integrations/MAT_AGENT_PROMPT.md`
3. Let the agent use:
   - `catalog --json` for capability discovery
   - `doctor` for environment validation
   - `report`, `run`, `query`, and `index` for analysis

## Why this structure

- The runtime is tool-agnostic.
- The prompt is reusable across ecosystems.
- Codex-specific metadata stays isolated in `skills/mat-heap-analysis/agents/openai.yaml`.

If a host tool has its own skill/plugin format, wrap the same launcher and prompt instead of forking the MAT logic.
