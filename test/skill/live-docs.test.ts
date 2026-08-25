import { describe, expect, test } from "vitest";

import { DOCS_INDEX_URL, OPENAPI_URL, checkLiveDocs, parseDiscoveryLinks } from "../../scripts/check-live-docs.mjs";

const guideSlugs = [
  "build-bounded-automation",
  "connect-ai-agent",
  "diagnose-api-failures",
  "lead-synchronization",
  "read-business-metrics",
  "update-lead-safely",
];

function discoveryIndex(origin = "https://docs.themochi.app"): string {
  return [
    "# Mochi Public API",
    ...guideSlugs.map((slug) => `- [${slug}](${origin}/${slug})`),
    `- [OpenAPI](${OPENAPI_URL})`,
  ].join("\n");
}

function fakeResponse(body: string, contentType = "text/markdown"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

describe("live documentation discovery", () => {
  test("parses the six same-origin guides and exact OpenAPI artifact", () => {
    const discovery = parseDiscoveryLinks(discoveryIndex(), DOCS_INDEX_URL);

    expect(discovery.guideUrls).toEqual(guideSlugs.map((slug) => `https://docs.themochi.app/${slug}`));
    expect(discovery.openapiUrl).toBe(OPENAPI_URL);
  });

  test("rejects missing guides and cross-origin guide links", () => {
    expect(() =>
      parseDiscoveryLinks(discoveryIndex().replace("/connect-ai-agent", "/missing"), DOCS_INDEX_URL),
    ).toThrow("connect-ai-agent");
    expect(() => parseDiscoveryLinks(discoveryIndex("https://evil.example"), DOCS_INDEX_URL)).toThrow("same origin");
  });

  test("checks every guide and the generated contract without credentials", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requested.push(url);
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      if (url === DOCS_INDEX_URL) return fakeResponse(discoveryIndex());
      if (url === OPENAPI_URL) {
        return fakeResponse(
          JSON.stringify({ openapi: "3.0.3", info: { title: "Mochi Public API" } }),
          "application/json",
        );
      }
      return fakeResponse(`# Guide\n\nUse the current [OpenAPI](${OPENAPI_URL}).`);
    };

    await expect(checkLiveDocs({ fetchImpl })).resolves.toEqual({ guideCount: 6, openapiVersion: "3.0.3" });
    expect(requested).toEqual([
      DOCS_INDEX_URL,
      ...guideSlugs.map((slug) => `https://docs.themochi.app/${slug}`),
      OPENAPI_URL,
    ]);
  });
});
