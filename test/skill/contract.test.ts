import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const skillRoot = resolve(repositoryRoot, "skills/mochi-api");
const skillPath = resolve(skillRoot, "SKILL.md");
const referenceNames = ["authentication.md", "docs-discovery.md", "integration-safety.md"];

async function skillFiles(): Promise<Array<{ path: string; content: string }>> {
  const paths = [
    skillPath,
    resolve(skillRoot, "agents/openai.yaml"),
    ...referenceNames.map((name) => resolve(skillRoot, "references", name)),
  ];
  return Promise.all(paths.map(async (path) => ({ path, content: await readFile(path, "utf8") })));
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

  test("keeps references one level deep", async () => {
    for (const referenceName of referenceNames) {
      const content = await readFile(resolve(skillRoot, "references", referenceName), "utf8");
      expect(content).not.toMatch(/\]\((?:\.\.\/)?references\//);
    }
  });
});
