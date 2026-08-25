import { describe, expect, test } from "vitest";

import { resolveStoragePaths } from "../../src/storage/paths.js";

describe("storage paths", () => {
  test("rejects a Windows config override unless a test adapter explicitly opts in", () => {
    expect(() =>
      resolveStoragePaths({
        platform: "win32",
        homeDirectory: "/users/mochi",
        environment: { MOCHI_CONFIG_DIR: "/arbitrary-acl-root" },
      }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });

  test("allows an injected Windows test adapter to supply a controlled override", () => {
    const paths = resolveStoragePaths({
      platform: "win32",
      homeDirectory: "/users/mochi",
      environment: { MOCHI_CONFIG_DIR: "/controlled-test-root" },
      allowWindowsOverrideForTests: true,
    });

    expect(paths.configDirectory).toBe("/controlled-test-root");
  });
});
