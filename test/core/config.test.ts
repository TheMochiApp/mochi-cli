import { describe, expect, test } from "vitest";

import { loadRuntimeConfig } from "../../src/core/config.js";

describe("runtime configuration", () => {
  test("rejects API overrides with a non-root path", () => {
    expect(() => loadRuntimeConfig({ MOCHI_API_URL: "https://evil.example/v1" })).toThrow("API base");
  });

  test("uses the canonical OpenAPI document by default", () => {
    const config = loadRuntimeConfig({});
    expect(config.issuerUrl).toBe("https://api.themochi.app");
    expect(config.openapiUrl).toBe("https://openapi.gitbook.com/o/M0sgy6xKutCblHRqGmE5/spec/mochi-api.json");
  });

  test("normalizes trailing slashes and permits loopback HTTP overrides", () => {
    expect(
      loadRuntimeConfig({
        MOCHI_API_URL: "http://127.0.0.1:8000///",
        MOCHI_ISSUER_URL: "http://127.0.0.1:8000///",
      }),
    ).toMatchObject({
      apiBaseUrl: "http://127.0.0.1:8000",
      issuerUrl: "http://127.0.0.1:8000",
    });
  });

  test("rejects the production issuer paired with an attacker API origin", () => {
    expect(() =>
      loadRuntimeConfig({
        MOCHI_API_URL: "https://attacker.example",
        MOCHI_ISSUER_URL: "https://api.themochi.app",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        message: "The Mochi API base and OAuth issuer must share one origin.",
      }),
    );
  });

  test("requires both local endpoints to use one explicit origin", () => {
    expect(() =>
      loadRuntimeConfig({
        MOCHI_API_URL: "http://127.0.0.1:8000",
        MOCHI_ISSUER_URL: "http://127.0.0.1:9000",
      }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });

  test("rejects insecure non-loopback endpoint overrides", () => {
    expect(() => loadRuntimeConfig({ MOCHI_ISSUER_URL: "http://evil.example" })).toThrow("HTTPS");
  });
});
