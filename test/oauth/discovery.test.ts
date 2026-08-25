import { describe, expect, test, vi } from "vitest";

import type { OAuthHttp } from "../../src/oauth/types.js";
import { discoverOAuth } from "../../src/oauth/discovery.js";
import { createOAuthHttp } from "../../src/oauth/http.js";

const ISSUER = "https://api.themochi.app";
const METADATA = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/api/zapier/oauth/authorize/`,
  token_endpoint: `${ISSUER}/api/zapier/oauth/token/`,
  registration_endpoint: `${ISSUER}/api/zapier/oauth/register/`,
  revocation_endpoint: `${ISSUER}/api/zapier/oauth/revoke/`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
};

function mockHttp(body: unknown = METADATA, status = 200): OAuthHttp {
  return {
    getJson: vi.fn(async () => ({ status, body })),
    postJson: vi.fn(),
    postForm: vi.fn(),
  };
}

describe("OAuth discovery", () => {
  test("discovers and validates the complete production metadata document", async () => {
    const http = mockHttp();

    await expect(discoverOAuth({ issuerUrl: ISSUER, http })).resolves.toEqual({
      issuer: ISSUER,
      authorizationEndpoint: METADATA.authorization_endpoint,
      tokenEndpoint: METADATA.token_endpoint,
      registrationEndpoint: METADATA.registration_endpoint,
      revocationEndpoint: METADATA.revocation_endpoint,
    });
    expect(http.getJson).toHaveBeenCalledWith(`${ISSUER}/.well-known/oauth-authorization-server`);
  });

  test("allows only the exact production frontend authorization origin exception", async () => {
    const http = mockHttp({
      ...METADATA,
      authorization_endpoint: "https://use.themochi.app/oauth/authorize/",
    });

    await expect(discoverOAuth({ issuerUrl: ISSUER, http })).resolves.toMatchObject({
      authorizationEndpoint: "https://use.themochi.app/oauth/authorize/",
    });
  });

  test.each([
    ["issuer mismatch", { ...METADATA, issuer: "https://evil.example" }],
    ["insecure endpoint", { ...METADATA, token_endpoint: "http://api.themochi.app/token" }],
    ["foreign endpoint", { ...METADATA, registration_endpoint: "https://evil.example/register" }],
    ["endpoint credentials", { ...METADATA, revocation_endpoint: "https://user@api.themochi.app/revoke" }],
    ["endpoint query", { ...METADATA, token_endpoint: `${ISSUER}/token?next=evil` }],
    ["unsupported PKCE", { ...METADATA, code_challenge_methods_supported: ["plain"] }],
    ["missing public auth", { ...METADATA, token_endpoint_auth_methods_supported: ["client_secret_post"] }],
  ])("rejects %s", async (_name, body) => {
    await expect(discoverOAuth({ issuerUrl: ISSUER, http: mockHttp(body) })).rejects.toMatchObject({
      code: "OAUTH_DISCOVERY_INVALID",
    });
  });

  test("permits HTTP only when the configured issuer and every endpoint are loopback", async () => {
    const issuer = "http://127.0.0.1:8000";
    const body = {
      ...METADATA,
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      revocation_endpoint: `${issuer}/revoke`,
    };

    await expect(discoverOAuth({ issuerUrl: issuer, http: mockHttp(body) })).resolves.toMatchObject({ issuer });
  });

  test("rejects non-success discovery without exposing the response body", async () => {
    const failure = await discoverOAuth({
      issuerUrl: ISSUER,
      http: mockHttp({ access_token: "must-not-leak" }, 500),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "OAUTH_DISCOVERY_FAILED" });
    expect(String(failure)).not.toContain("must-not-leak");
  });
});

describe("OAuth HTTP boundary", () => {
  test("disables redirects and sends form bodies without retry behavior", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response("{}", { status: 200 });
    });
    const http = createOAuthHttp({ fetch: fetch as unknown as typeof globalThis.fetch });

    await http.postForm("https://api.themochi.app/token", new URLSearchParams({ grant_type: "test" }));

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      body: "grant_type=test",
    });
  });

  test("sanitizes fetch failures without exposing transport error content", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      throw new Error("redirect included access_token=must-not-leak");
    });
    const http = createOAuthHttp({ fetch: fetch as unknown as typeof globalThis.fetch });

    const failure = await http.getJson("https://api.themochi.app/discovery").catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "OAUTH_NETWORK_ERROR" });
    expect(String(failure)).not.toContain("must-not-leak");
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("cancels a chunked response as soon as it crosses the 64 KiB cap", async () => {
    let pulls = 0;
    let cancelled = false;
    const marker = new TextEncoder().encode('"access_token":"must-not-leak"');
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          const chunk = new Uint8Array(32 * 1024);
          chunk.set(marker);
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const fetch = vi.fn(async () => new Response(stream, { status: 200 }));
    const http = createOAuthHttp({ fetch: fetch as unknown as typeof globalThis.fetch });

    const failure = await http.getJson("https://api.themochi.app/discovery").catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "OAUTH_RESPONSE_INVALID" });
    expect(String(failure)).not.toContain("must-not-leak");
    expect(pulls).toBe(3);
    expect(cancelled).toBe(true);
  });

  test("rejects malformed UTF-8 without exposing body bytes", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([0xc3, 0x28]), { status: 200 }));
    const http = createOAuthHttp({ fetch: fetch as unknown as typeof globalThis.fetch });

    await expect(http.getJson("https://api.themochi.app/discovery")).rejects.toMatchObject({
      code: "OAUTH_RESPONSE_INVALID",
    });
  });
});
