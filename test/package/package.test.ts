import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

interface PackFile {
  path: string;
}

interface PackResult {
  files: PackFile[];
}

const repositoryRoot = resolve(import.meta.dirname, "../..");
let packageFiles: string[];

beforeAll(() => {
  execFileSync("npm", ["run", "build", "--silent"], {
    cwd: repositoryRoot,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const output = execFileSync("npm", ["pack", "--json", "--dry-run", "--ignore-scripts"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const result = JSON.parse(output) as PackResult[];
  packageFiles = result[0]?.files.map((file) => file.path.replaceAll("\\", "/")).sort() ?? [];
});

describe("published package", () => {
  it("contains only the release allowlist", () => {
    expect(packageFiles).toEqual(
      expect.arrayContaining(["dist/cli.js", "LICENSE", "package.json", "README.md", "SECURITY.md"]),
    );
    expect(
      packageFiles.every(
        (path) => path.startsWith("dist/") || ["LICENSE", "package.json", "README.md", "SECURITY.md"].includes(path),
      ),
    ).toBe(true);
  });

  it("does not publish source, tests, fixtures, environment files, credentials, or design work", () => {
    const prohibitedPath =
      /(^|\/)(?:src|source|sources|test|tests|fixtures|credentials|docs|\.env(?:\.|$)|\.superpowers)(?:\/|$)/iu;
    expect(packageFiles.some((path) => prohibitedPath.test(path))).toBe(false);
  });

  it("does not embed TypeScript sources in source maps", async () => {
    const sourceMaps = packageFiles.filter((path) => path.endsWith(".map"));
    for (const sourceMap of sourceMaps) {
      const parsed = JSON.parse(await readFile(resolve(repositoryRoot, sourceMap), "utf8")) as {
        sourcesContent?: unknown[];
      };
      expect(parsed.sourcesContent ?? []).toHaveLength(0);
    }
  });

  it("publishes the expected executable contract", async () => {
    const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8")) as {
      name?: string;
      type?: string;
      bin?: Record<string, string>;
      engines?: Record<string, string>;
    };
    const executable = await readFile(resolve(repositoryRoot, "dist/cli.js"), "utf8");

    expect(packageJson).toMatchObject({
      name: "@themochiapp/cli",
      type: "module",
      bin: { mochi: "dist/cli.js" },
      engines: { node: ">=20" },
    });
    expect(executable.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
