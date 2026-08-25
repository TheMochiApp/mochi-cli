import { describe, expect, test } from "vitest";

import { inspectPackagePaths, inspectSourceMap } from "../../scripts/package-policy.mjs";

const SAFE_PACKAGE = ["dist/cli.js", "LICENSE", "package.json", "README.md", "SECURITY.md"];

describe("release package path policy", () => {
  test("accepts the strict release root and dist allowlist", () => {
    expect(inspectPackagePaths(SAFE_PACKAGE)).toEqual([]);
  });

  test.each([
    "dist/credentials.json",
    "dist/nested/access-token.json",
    "dist/private/key/value.json",
    "dist/.env.production",
    "dist/oauth/client-secret.txt",
  ])("rejects sensitive-looking content even under dist: %s", (path) => {
    expect(inspectPackagePaths([...SAFE_PACKAGE, path])).toContain(
      `The package contains sensitive-looking path ${path}.`,
    );
  });

  test.each(["src/cli.ts", "test/fixture.json", "docs/design.md", ".env"])(
    "rejects content outside the release allowlist: %s",
    (path) => {
      expect(inspectPackagePaths([...SAFE_PACKAGE, path])).toContain(`The package contains disallowed file ${path}.`);
    },
  );

  test("rejects source maps that embed source content", () => {
    expect(inspectSourceMap("dist/cli.js.map", { sourcesContent: ["private source"] })).toEqual([
      "dist/cli.js.map embeds source content.",
    ]);
    expect(inspectSourceMap("dist/cli.js.map", { sources: ["cli.ts"] })).toEqual([]);
  });
});
