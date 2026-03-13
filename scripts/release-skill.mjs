import { spawnSync } from "node:child_process";

const repoFlagIndex = process.argv.indexOf("--repo");
const repo = repoFlagIndex >= 0 ? process.argv[repoFlagIndex + 1] : undefined;

run("npm", ["run", "build"]);
run("npm", ["run", "build:skill"]);
run("npm", ["test"]);
run("npm", ["run", "check:skill"]);

console.log("\n[OK] skill release pipeline passed");
console.log("Next:");
console.log("1. Commit and push the repo to GitHub.");
console.log("2. Install from the skill subdirectory:");
console.log("");
console.log(
  repo
    ? `python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \\\n  --repo ${repo} \\\n  --path skills/mat-heap-analysis`
    : "python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \\\n  --repo <owner>/<repo> \\\n  --path skills/mat-heap-analysis"
);
console.log("");
console.log("3. Restart Codex.");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
