import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const WORKFLOW_URL = new URL("../../.github/workflows/publish.yml", import.meta.url);
const RELEASING_URL = new URL("../../RELEASING.md", import.meta.url);

describe("release control contract", () => {
  test("binds the workflow run ref to the requested release tag", async () => {
    const workflow = await readFile(WORKFLOW_URL, "utf8");

    expect(workflow).toContain("RELEASE_RUN_REF: ${{ github.ref }}");
    expect(workflow).toContain('test "$RELEASE_RUN_REF" = "refs/tags/$RELEASE_TAG"');
  });

  test("requires maintainers to select and enter the same protected tag", async () => {
    const releasing = await readFile(RELEASING_URL, "utf8");

    expect(releasing).toContain("select that exact protected `v*` tag in GitHub Actions “Use workflow from”");
    expect(releasing).toContain("enter the same tag in the `tag` input");
    expect(releasing).toContain("environment tag restrictions evaluate the workflow run ref");
  });

  test("documents the manual no-code first-publication bootstrap without token automation", async () => {
    const releasing = await readFile(RELEASING_URL, "utf8");

    expect(releasing).toContain("## One-time first-publication bootstrap");
    expect(releasing).toContain("`@themochiapp/cli@0.0.0`");
    expect(releasing).toContain('"scripts": {}');
    expect(releasing).toContain("npm login --auth-type=web");
    expect(releasing).toContain("npm logout");
    expect(releasing).toContain("Codex and CI must never perform this bootstrap");
    expect(releasing).toContain("automation, classic, or granular npm token");
    expect(releasing).toContain("workflow filename `publish.yml`, environment `production`");
    expect(releasing).toContain("Publication is forbidden until the package exists");
    expect(releasing).not.toMatch(/(?:NPM_TOKEN|NODE_AUTH_TOKEN)\s*=/u);
  });
});
