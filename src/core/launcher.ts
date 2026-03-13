import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MatCliError } from "../types.js";

export interface LauncherOptions {
  matLauncher?: string;
  matHome?: string;
}

export function resolveMatLauncher(options: LauncherOptions): string {
  if (options.matLauncher) {
    const absolute = path.resolve(options.matLauncher);
    try {
      return fs.realpathSync(absolute);
    } catch {
      throw new MatCliError({
        category: "MAT_NOT_FOUND",
        message: `MAT launcher not found: ${absolute}`,
        hint: "Set MAT_LAUNCHER or --mat-launcher to a valid org.eclipse.equinox.launcher_*.jar path."
      });
    }
  }

  if (!options.matHome) {
    throw new MatCliError({
      category: "MAT_NOT_FOUND",
      message: "MAT launcher is not configured.",
      hint: "Set MAT_LAUNCHER or MAT_HOME, or pass --mat-launcher / --mat-home."
    });
  }

  const pluginDir = path.join(path.resolve(options.matHome), "plugins");
  if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) {
    throw new MatCliError({
      category: "MAT_NOT_FOUND",
      message: `MAT plugins directory missing: ${pluginDir}`,
      hint: "Verify MAT_HOME points to the Eclipse MAT installation root."
    });
  }

  const launcherCandidate = fs
    .readdirSync(pluginDir)
    .filter((name) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(name))
    .sort()
    .at(-1);

  if (!launcherCandidate) {
    throw new MatCliError({
      category: "MAT_NOT_FOUND",
      message: `No launcher jar found in: ${pluginDir}`,
      hint: "Install Eclipse MAT or configure MAT_LAUNCHER explicitly."
    });
  }

  return path.join(pluginDir, launcherCandidate);
}

export function detectJavaVersion(javaPath: string): string {
  const result = spawnSync(javaPath, ["-version"], {
    encoding: "utf8",
    timeout: 10_000
  });

  if (result.error) {
    throw new MatCliError({
      category: "MAT_NOT_FOUND",
      message: `Failed to run Java: ${result.error.message}`,
      hint: "Set JAVA_PATH or --java-path to a valid java executable."
    });
  }

  if (result.status !== 0) {
    throw new MatCliError({
      category: "MAT_NOT_FOUND",
      message: "Java runtime is unavailable.",
      hint: "Install Java and ensure JAVA_PATH points to the java binary.",
      stdoutTail: result.stdout ?? "",
      stderrTail: result.stderr ?? "",
      exitCode: result.status
    });
  }

  const versionLine = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return versionLine ?? "unknown";
}
