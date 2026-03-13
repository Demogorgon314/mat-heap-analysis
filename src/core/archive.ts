import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

export type ArtifactSourceKind = "directory" | "zip";

export interface ArtifactEntry {
  path: string;
  isDirectory: boolean;
  size: number;
}

export interface ArtifactSource {
  kind: ArtifactSourceKind;
  rootPath: string;
  listEntries(): ArtifactEntry[];
  hasEntry(relativePath: string): boolean;
  readText(relativePath: string): string | null;
}

export function openArtifactSource(targetPath: string): ArtifactSource {
  const absolute = path.resolve(targetPath);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    return createDirectorySource(absolute);
  }
  if (stat.isFile() && absolute.toLowerCase().endsWith(".zip")) {
    return createZipSource(absolute);
  }
  throw new Error(`Unsupported artifact source: ${absolute}`);
}

function createDirectorySource(rootPath: string): ArtifactSource {
  return {
    kind: "directory",
    rootPath,
    listEntries() {
      return walkDirectory(rootPath);
    },
    hasEntry(relativePath: string) {
      const absolute = path.join(rootPath, normalizeRelativePath(relativePath));
      return fs.existsSync(absolute);
    },
    readText(relativePath: string) {
      const absolute = path.join(rootPath, normalizeRelativePath(relativePath));
      try {
        return fs.readFileSync(absolute, "utf8");
      } catch {
        return null;
      }
    }
  };
}

function createZipSource(rootPath: string): ArtifactSource {
  const zip = new AdmZip(rootPath);
  const entries = zip.getEntries();

  return {
    kind: "zip",
    rootPath,
    listEntries() {
      return entries.map((entry) => ({
        path: normalizeRelativePath(entry.entryName),
        isDirectory: entry.isDirectory,
        size: entry.header.size
      }));
    },
    hasEntry(relativePath: string) {
      return zip.getEntry(normalizeRelativePath(relativePath)) !== null;
    },
    readText(relativePath: string) {
      const entry = zip.getEntry(normalizeRelativePath(relativePath));
      if (!entry || entry.isDirectory) {
        return null;
      }
      try {
        return entry.getData().toString("utf8");
      } catch {
        return null;
      }
    }
  };
}

function walkDirectory(rootPath: string): ArtifactEntry[] {
  const results: ArtifactEntry[] = [];

  function visit(currentPath: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(currentPath, entry.name);
      const relative = normalizeRelativePath(path.relative(rootPath, absolute));
      const stat = fs.statSync(absolute);
      results.push({
        path: relative,
        isDirectory: entry.isDirectory(),
        size: stat.size
      });
      if (entry.isDirectory()) {
        visit(absolute);
      }
    }
  }

  visit(rootPath);
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}
