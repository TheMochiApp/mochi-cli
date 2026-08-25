import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = new Set(["dist/cli.js", "LICENSE", "package.json", "README.md", "SECURITY.md"]);
const allowedRootFiles = new Set(["LICENSE", "package.json", "README.md", "SECURITY.md"]);

const output = execFileSync("npm", ["pack", "--json", "--dry-run", "--ignore-scripts"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  shell: process.platform === "win32",
});
const packResults = JSON.parse(output);
if (!Array.isArray(packResults) || packResults.length !== 1 || !Array.isArray(packResults[0]?.files)) {
  fail("npm pack returned an unexpected manifest.");
}

const packageFiles = packResults[0].files.map((file) => String(file.path).replaceAll("\\", "/")).sort();
for (const requiredFile of requiredFiles) {
  if (!packageFiles.includes(requiredFile)) fail(`The package is missing ${requiredFile}.`);
}
for (const packageFile of packageFiles) {
  if (!packageFile.startsWith("dist/") && !allowedRootFiles.has(packageFile)) {
    fail(`The package contains disallowed file ${packageFile}.`);
  }
}

const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
if (packageJson.name !== "@themochiapp/cli") fail("Unexpected package name.");
if (packageJson.type !== "module") fail("The package must use ESM.");
if (packageJson.bin?.mochi !== "dist/cli.js") fail("The mochi executable mapping is missing.");
if (packageJson.engines?.node !== ">=20") fail("The Node.js runtime floor must be 20.");

const executable = await readFile(resolve(repositoryRoot, "dist/cli.js"), "utf8");
if (!executable.startsWith("#!/usr/bin/env node\n")) fail("dist/cli.js is missing the Node.js shebang.");

for (const packageFile of packageFiles.filter((path) => path.endsWith(".map"))) {
  const sourceMap = JSON.parse(await readFile(resolve(repositoryRoot, packageFile), "utf8"));
  if (Array.isArray(sourceMap.sourcesContent) && sourceMap.sourcesContent.length > 0) {
    fail(`${packageFile} embeds source content.`);
  }
}

process.stdout.write(`Verified ${packageFiles.length} package files.\n`);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
