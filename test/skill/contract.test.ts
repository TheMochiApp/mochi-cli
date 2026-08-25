import { access, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { inspectSkillRepository } from "../../scripts/verify-skill.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const skillRoot = resolve(repositoryRoot, "skills/mochi-api");
const skillPath = resolve(skillRoot, "SKILL.md");
const referenceNames = ["authentication.md", "docs-discovery.md", "integration-safety.md"];

async function skillFiles(): Promise<Array<{ path: string; content: string }>> {
  const paths: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(path);
    }
  }
  await visit(skillRoot);
  return Promise.all(paths.map(async (path) => ({ path, content: await readFile(path, "utf8") })));
}

async function withRepositoryCopy(run: (repositoryCopy: string) => Promise<void>): Promise<void> {
  const repositoryCopy = await mkdtemp(join(tmpdir(), "mochi-skill-contract-"));
  try {
    await mkdir(resolve(repositoryCopy, "skills"));
    await cp(resolve(repositoryRoot, "skills/mochi-api"), resolve(repositoryCopy, "skills/mochi-api"), {
      recursive: true,
    });
    await run(repositoryCopy);
  } finally {
    await rm(repositoryCopy, { recursive: true, force: true });
  }
}

describe("mochi-api skill structure", () => {
  test("has one nested skill with the required direct references", async () => {
    await expect(access(resolve(repositoryRoot, "SKILL.md"))).rejects.toThrow();
    const entries = (await readdir(resolve(repositoryRoot, "skills"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(entries).toEqual(["mochi-api"]);

    const entrypoint = await readFile(skillPath, "utf8");
    expect(entrypoint).toMatch(/^---\nname: mochi-api\ndescription: .+\n---\n/);
    for (const referenceName of referenceNames) {
      expect(entrypoint.match(new RegExp(`references/${referenceName.replace(".", "\\.")}`, "g"))).toHaveLength(1);
    }
  });

  test("provides OpenAI interface metadata that invokes the skill", async () => {
    const metadata = await readFile(resolve(skillRoot, "agents/openai.yaml"), "utf8");
    expect(metadata).toContain('display_name: "Mochi API"');
    expect(metadata).toContain("$mochi-api");
    expect(metadata).not.toContain("allow_implicit_invocation: false");
  });

  test("keeps volatile API and credential details out of every skill file", async () => {
    const files = await skillFiles();
    const combined = files.map(({ content }) => content).join("\n");

    expect(combined).not.toMatch(/\/v1\//);
    expect(combined).not.toMatch(/operation[_-]?id/i);
    expect(combined).not.toMatch(/\b(?:get|post|put|patch|delete)_[a-z0-9]+(?:_[a-z0-9]+){2,}\b/i);
    expect(combined).not.toMatch(/\?[a-z0-9_-]+=/i);
    expect(combined).not.toMatch(/"[a-z][a-z0-9_]*"\s*:/i);
    expect(combined).not.toMatch(/mochi_sk_(?:live|test)_/i);
    expect(combined).not.toMatch(/Authorization:\s*Bearer/i);
    expect(combined).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(combined).not.toContain("TheMochiApp/mochi-agent");
    expect(combined).not.toMatch(
      /mochi\s+(?:api|automations?|flows?|leads?)\s+(?:create|delete|patch|post|run|send|update)/i,
    );
    expect(combined).not.toMatch(/\b\d+\s+(?:requests?|seconds?|minutes?|hours?)\b/i);
  });

  test("rejects unexpected skill files and scans real operation identifier shapes", async () => {
    await withRepositoryCopy(async (repositoryCopy) => {
      const skillCopy = resolve(repositoryCopy, "skills/mochi-api");
      await writeFile(resolve(skillCopy, "references/endpoints.md"), "# Copied endpoints\n\nget_public_leads_list\n");

      const errors = await inspectSkillRepository(repositoryCopy);

      expect(errors).toContain("Unexpected skill file: references/endpoints.md.");
      expect(errors).toContain("references/endpoints.md contains forbidden copied operation identifier.");
    });
  });

  test("keeps references one level deep", async () => {
    for (const referenceName of referenceNames) {
      const content = await readFile(resolve(skillRoot, "references", referenceName), "utf8");
      expect(content).not.toMatch(/\]\((?:\.\.\/)?references\//);
    }
  });

  test("documents installation and the stable maintenance boundary", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");
    const maintenance = await readFile(resolve(repositoryRoot, "docs/skill-maintenance.md"), "utf8");
    const evaluation = await readFile(
      resolve(repositoryRoot, "docs/evaluations/2026-08-25-mochi-api-skill.md"),
      "utf8",
    );

    expect(readme).toContain("npx skills add TheMochiApp/mochi-cli --skill mochi-api");
    expect(readme).toContain("https://docs.themochi.app/llms.txt");
    expect(maintenance).toContain("Routine API changes do not require a skill release");
    expect(maintenance).toContain("authentication-mode decision matrix");
    expect(maintenance).toContain("canonical documentation discovery entry point");
    expect(maintenance).toContain("CLI credential or read/write boundary");
    expect(maintenance).toContain("cross-cutting security invariant");
    expect(evaluation.match(/Result: PASS/g)).toHaveLength(3);
  });
});
