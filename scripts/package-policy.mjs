export const requiredPackageFiles = Object.freeze([
  "dist/cli.js",
  "LICENSE",
  "package.json",
  "README.md",
  "SECURITY.md",
]);

const allowedRootFiles = new Set(["LICENSE", "package.json", "README.md", "SECURITY.md"]);
const sensitiveWords = new Set(["credential", "credentials", "key", "keys", "secret", "secrets", "token", "tokens"]);

export function inspectPackagePaths(paths) {
  const packageFiles = paths.map(normalizePath).sort();
  const errors = [];

  for (const requiredFile of requiredPackageFiles) {
    if (!packageFiles.includes(requiredFile)) errors.push(`The package is missing ${requiredFile}.`);
  }
  for (const packageFile of packageFiles) {
    if (!packageFile.startsWith("dist/") && !allowedRootFiles.has(packageFile)) {
      errors.push(`The package contains disallowed file ${packageFile}.`);
    }
    if (hasSensitiveSegment(packageFile)) {
      errors.push(`The package contains sensitive-looking path ${packageFile}.`);
    }
  }

  return errors;
}

export function inspectSourceMap(packageFile, sourceMap) {
  if (
    typeof sourceMap === "object" &&
    sourceMap !== null &&
    Array.isArray(sourceMap.sourcesContent) &&
    sourceMap.sourcesContent.length > 0
  ) {
    return [`${normalizePath(packageFile)} embeds source content.`];
  }
  return [];
}

function normalizePath(path) {
  return String(path).replaceAll("\\", "/");
}

function hasSensitiveSegment(path) {
  return normalizePath(path)
    .split("/")
    .filter(Boolean)
    .some((segment) => {
      const normalized = segment.toLowerCase();
      if (normalized === ".env" || normalized.startsWith(".env.")) return true;
      return normalized
        .split(/[._-]+/u)
        .filter(Boolean)
        .some((word) => sensitiveWords.has(word));
    });
}
