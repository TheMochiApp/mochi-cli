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
  return ["# Mochi Public API", ...guideSlugs.map((slug) => `- [${slug}](${origin}/${slug})`)].join("\n");
}

function fakeResponse(body: string, contentType = "text/markdown"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

describe("live documentation discovery", () => {
  test("parses the six same-origin guides without requiring llms.txt to expose OpenAPI directly", () => {
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

  test("rejects a noncanonical OpenAPI link when llms.txt declares one", () => {
    const staleUrl = "https://openapi.gitbook.com/o/stale/spec/mochi-api.json";
    expect(() => parseDiscoveryLinks(`${discoveryIndex()}\n- [OpenAPI](${staleUrl})`)).toThrow(
      "noncanonical OpenAPI link",
    );
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

  test("rejects a guide that mentions but does not link the canonical OpenAPI URL", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === DOCS_INDEX_URL) return fakeResponse(discoveryIndex());
      if (url === OPENAPI_URL) {
        return fakeResponse(JSON.stringify({ openapi: "3.0.3", info: { title: "Mochi Public API" } }));
      }
      return fakeResponse(`# Guide\n\nCanonical contract: ${OPENAPI_URL}`);
    };

    await expect(checkLiveDocs({ fetchImpl })).rejects.toThrow("does not link the canonical OpenAPI artifact");
  });

  test("aborts a streamed response after the byte limit", async () => {
    const oversizedChunk = new Uint8Array(2_000_001);
    let streamCancelled = false;
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(oversizedChunk);
          },
          cancel() {
            streamCancelled = true;
          },
        }),
        { status: 200 },
      );

    await expect(checkLiveDocs({ fetchImpl })).rejects.toThrow("exceeded the response-size limit");
    expect(streamCancelled).toBe(true);
  });
});
