import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { describe, expect, test } from "vitest";

import { skillInstallSource, skillInstallerInvocation } from "../../scripts/install-skill-smoke.mjs";
import { inspectSkillRepository } from "../../scripts/verify-skill.mjs";

interface PackFile {
  path: string;
}

interface PackResult {
  files: PackFile[];
}

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("skill distribution", () => {
  test("uses a shell-backed npx.cmd invocation on Windows only", () => {
    expect(skillInstallerInvocation("win32")).toEqual({ executable: "npx.cmd", shell: true });
    expect(skillInstallerInvocation("linux")).toEqual({ executable: "npx", shell: false });
  });

  test("uses the checked-out repository locally and the canonical GitHub source when requested", () => {
    expect(skillInstallSource({})).toBe(repositoryRoot);
    expect(skillInstallSource({ MOCHI_SKILL_SOURCE: "https://github.com/TheMochiApp/mochi-cli.git" })).toBe(
      "https://github.com/TheMochiApp/mochi-cli.git",
    );
  });

  test("passes the deterministic repository validator", async () => {
    await expect(inspectSkillRepository(repositoryRoot)).resolves.toEqual([]);
  });

  test("the skills CLI discovers exactly mochi-api", () => {
    const output = execFileSync("npx", ["--yes", "skills@1.5.18", "add", ".", "--list"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    const normalizedOutput = stripVTControlCharacters(output);

    expect(normalizedOutput).toContain("Found 1 skill");
    expect(normalizedOutput).toContain("mochi-api");
  }, 30_000);

  test("skill files remain outside the npm release tarball", () => {
    const output = execFileSync("npm", ["pack", "--json", "--dry-run", "--ignore-scripts"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    const result = JSON.parse(output) as PackResult[];
    const paths = result[0]?.files.map((file) => file.path.replaceAll("\\", "/")) ?? [];

    expect(paths.some((path) => path.startsWith("skills/"))).toBe(false);
  });

  test("ci invokes both structural and clean-install checks", async () => {
    const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["verify:skill"]).toBe("node scripts/verify-skill.mjs");
    expect(packageJson.scripts?.["verify:skill-install"]).toBe("node scripts/install-skill-smoke.mjs");
    expect(packageJson.scripts?.ci).toContain("npm run verify:skill");
  });
});
