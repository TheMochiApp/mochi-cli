import { describe, expect, test } from "vitest";

import { loadRuntimeConfig } from "../../src/core/config.js";

describe("runtime configuration", () => {
  test("rejects API overrides with a non-root path", () => {
    expect(() => loadRuntimeConfig({ MOCHI_API_URL: "https://evil.example/v1" })).toThrow("API base");
  });

  test("uses the canonical OpenAPI document by default", () => {
    expect(loadRuntimeConfig({}).openapiUrl).toBe(
      "https://openapi.gitbook.com/o/M0sgy6xKutCblHRqGmE5/spec/mochi-api.json",
    );
  });

  test("normalizes trailing slashes and permits loopback HTTP overrides", () => {
    expect(
      loadRuntimeConfig({
        MOCHI_API_URL: "http://127.0.0.1:8000///",
        MOCHI_ISSUER_URL: "http://localhost:9000///",
      }),
    ).toMatchObject({
      apiBaseUrl: "http://127.0.0.1:8000",
      issuerUrl: "http://localhost:9000",
    });
  });

  test("rejects insecure non-loopback endpoint overrides", () => {
    expect(() => loadRuntimeConfig({ MOCHI_ISSUER_URL: "http://evil.example" })).toThrow("HTTPS");
  });
});
