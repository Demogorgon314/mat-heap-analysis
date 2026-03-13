# Codex Integration

Use the Codex skill in `skills/mat-heap-analysis` when you want automatic skill discovery inside Codex.

## Install

After this repo is on GitHub:

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo <owner>/<repo> \
  --path skills/mat-heap-analysis
```

Restart Codex after installation.

## Runtime

The skill uses:

```bash
node scripts/mat.cjs
```

## Discovery

Inside Codex, the runtime is designed to be self-describing:

```bash
node scripts/mat.cjs
node scripts/mat.cjs catalog --json
node scripts/mat.cjs query --help
```

## Notes

- Codex-specific metadata is in `skills/mat-heap-analysis/agents/openai.yaml`.
- The runtime itself is not Codex-specific; other agent tools should reuse the same launcher and prompt.
