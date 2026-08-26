import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { OPENAPI_URL } from "../../scripts/check-live-docs.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function repositoryFile(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

function workflowJob(workflow: string, name: string): string {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name} workflow job.`);
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/\n {2}[a-z][a-z0-9-]*:\n/u);
  return nextJob < 0 ? remainder : remainder.slice(0, nextJob);
}

describe("skill maintenance automation", () => {
  test("runs full CI for pull requests and every push to main", async () => {
    const workflow = await repositoryFile(".github/workflows/ci.yml");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toMatch(/push:\n\s+branches:\n\s+- main/u);
    expect(workflow).toContain("skills-ref validate skills/mochi-api");
    expect(workflow).toContain("npm run verify:skill-install");
    expect(workflow).toContain("npm run ci");
  });

  test("checks the public GitHub installation and live docs every day", async () => {
    const workflow = await repositoryFile(".github/workflows/skill-live-docs.yml");

    expect(workflow).toContain('cron: "17 8 * * *"');
    expect(workflow).toMatch(/jobs:\n {2}public-install:/u);
    expect(workflow).toMatch(/\n {2}discovery:\n/u);
    expect(workflow).toContain("MOCHI_SKILL_SOURCE: https://github.com/TheMochiApp/mochi-cli.git");

    const publicInstall = workflowJob(workflow, "public-install");
    const discovery = workflowJob(workflow, "discovery");
    expect(publicInstall).toContain("npm run verify:skill-install");
    expect(publicInstall).not.toContain("npm run check:live-docs");
    expect(discovery).toContain("npm run check:live-docs");
    expect(discovery).not.toContain("needs:");
    expect(discovery).not.toContain("npm run verify:skill-install");
  });

  test("uses the current canonical OpenAPI URL throughout code and workflows", async () => {
    const paths = [
      "src/core/config.ts",
      "scripts/check-live-docs.mjs",
      ".github/workflows/live-contract.yml",
      ".github/workflows/publish.yml",
      "docs/superpowers/specs/2026-08-25-mochi-cli-design.md",
      "docs/superpowers/plans/2026-08-25-mochi-cli.md",
    ];
    const combined = (await Promise.all(paths.map(repositoryFile))).join("\n");

    expect(OPENAPI_URL).toBe("https://openapi.gitbook.com/o/bpgVa93BfrzaqXzuggv8/spec/mochi-api.json");
    expect(combined).not.toContain("M0sgy6xKutCblHRqGmE5");
    for (const path of paths) {
      expect(await repositoryFile(path)).toContain(OPENAPI_URL);
    }
  });
});
