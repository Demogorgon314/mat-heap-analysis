import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outfile = path.join(repoRoot, "skills", "mat-heap-analysis", "assets", "runtime", "mat.cjs");

await mkdir(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(repoRoot, "src", "skill-entry.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  minify: false
});

console.log(`Built skill runtime: ${outfile}`);
