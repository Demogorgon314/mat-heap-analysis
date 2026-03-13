import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const skillDir = path.join(repoRoot, "skills", "mat-heap-analysis");
const requiredFiles = [
  path.join(skillDir, "SKILL.md"),
  path.join(skillDir, "agents", "openai.yaml"),
  path.join(skillDir, "assets", "runtime", "mat.cjs"),
  path.join(skillDir, "references", "commands.md"),
  path.join(skillDir, "scripts", "mat"),
  path.join(skillDir, "scripts", "mat.cjs"),
  path.join(repoRoot, "integrations", "agent-pack.json"),
  path.join(repoRoot, "integrations", "README.md"),
  path.join(repoRoot, "integrations", "MAT_AGENT_PROMPT.md"),
  path.join(repoRoot, "integrations", "codex.md"),
  path.join(repoRoot, "integrations", "claude.md"),
  path.join(repoRoot, "integrations", "opencode.md")
];

for (const filePath of requiredFiles) {
  if (!existsSync(filePath)) {
    fail(`Missing required skill file: ${filePath}`);
  }
}

const openaiYaml = readFileSync(path.join(skillDir, "agents", "openai.yaml"), "utf8");
if (!openaiYaml.includes("display_name:") || !openaiYaml.includes("default_prompt:")) {
  fail("agents/openai.yaml is missing required interface fields.");
}

runAndCheck(
  "node",
  [path.join(skillDir, "scripts", "mat.cjs"), "catalog", "commands", "--json"],
  "node launcher"
);

runAndCheck(
  path.join(skillDir, "scripts", "mat"),
  ["catalog", "commands", "--json"],
  "shell launcher"
);

console.log("[OK] skill release checks passed");

function runAndCheck(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    fail(`${label} failed:\n${result.stderr || result.stdout}`);
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    fail(`${label} did not emit valid JSON.`);
  }

  if (payload.command !== "catalog" || payload.section !== "commands") {
    fail(`${label} returned unexpected payload.`);
  }
}

function fail(message) {
  console.error(`[ERROR] ${message}`);
  process.exit(1);
}
