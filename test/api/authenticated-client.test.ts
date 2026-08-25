import { describe, expect, test, vi } from "vitest";

import { AuthenticatedClient } from "../../src/api/authenticated-client.js";
import type { RuntimeConfig } from "../../src/core/config.js";
import { CliError, ExitCode } from "../../src/core/errors.js";
import type { OAuthHttp } from "../../src/oauth/types.js";
import { PUBLIC_API_RESOURCE, type CredentialBundle, type CredentialRepository } from "../../src/storage/types.js";

const CONFIG: RuntimeConfig = {
  apiBaseUrl: "https://api.themochi.app",
  issuerUrl: "https://api.themochi.app",
  openapiUrl: "https://openapi.example/spec.json",
};

function bundle(overrides: Partial<CredentialBundle> = {}): CredentialBundle {
  return {
    accessToken: "access-old",
    refreshToken: "refresh-old",
    accessExpiresAt: "2026-08-25T13:00:00.000Z",
    scopes: ["leads:read"],
    resource: PUBLIC_API_RESOURCE,
    clientId: "client-id",
    tokenEndpoint: "https://api.themochi.app/oauth/token/",
    revocationEndpoint: "https://api.themochi.app/oauth/revoke/",
    apiBaseUrl: CONFIG.apiBaseUrl,
    ...overrides,
  };
}

function repository(initial: CredentialBundle | null) {
  let stored = initial;
  const value: CredentialRepository = {
    backend: "file-0600",
    getCredentials: vi.fn(async () => stored),
    setCredentials: vi.fn(async (next) => {
      stored = next;
    }),
    deleteCredentials: vi.fn(async () => {
      stored = null;
    }),
    getClientRecord: vi.fn(async () => null),
    setClientRecord: vi.fn(),
    deleteClientRecord: vi.fn(),
  };
  return {
    value,
    get stored() {
      return stored;
    },
  };
}

function oauthHttp(response: unknown = {}): OAuthHttp {
  return {
    getJson: vi.fn(),
    postJson: vi.fn(),
    postForm: vi.fn(async () => ({ status: 200, body: response })),
  };
}

function serialLock() {
  let tail = Promise.resolve();
  return async <Result>(_path: string, callback: () => Promise<Result>): Promise<Result> => {
    const previous = tail;
    let release = (): void => undefined;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback();
    } finally {
      release();
    }
  };
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("AuthenticatedClient", () => {
  test("uses an unexpired access token without refreshing", async () => {
    const credentials = repository(bundle());
    const http = oauthHttp();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ id: "lead-1" }, 200, { "x-request-id": "req-1" }),
    );
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http,
      fetch,
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    await expect(client.get("/v1/leads/lead-1/?include=tags")).resolves.toEqual({
      status: 200,
      body: { id: "lead-1" },
      requestId: "req-1",
    });
    expect(http.postForm).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.themochi.app/v1/leads/lead-1/?include=tags");
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-old");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("refreshes within 60 seconds and stores rotation before the GET", async () => {
    const credentials = repository(bundle({ accessExpiresAt: "2026-08-25T12:00:30.000Z" }));
    const http = oauthHttp({
      access_token: "access-new",
      refresh_token: "refresh-new",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "leads:read",
    });
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(credentials.stored?.accessToken).toBe("access-new");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-new");
      return jsonResponse({ refreshed: true });
    });
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http,
      fetch,
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    await client.get("/v1/leads/");

    expect(http.postForm).toHaveBeenCalledOnce();
    expect(http.postForm).toHaveBeenCalledWith(
      "https://api.themochi.app/oauth/token/",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "refresh-old",
        client_id: "client-id",
        resource: PUBLIC_API_RESOURCE,
      }),
    );
    expect(credentials.stored).toMatchObject({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      accessExpiresAt: "2026-08-25T13:00:00.000Z",
    });
  });

  test("two concurrent clients reload under the lease and make one refresh", async () => {
    const credentials = repository(bundle({ accessExpiresAt: "2026-08-25T12:00:30.000Z" }));
    const http = oauthHttp({
      access_token: "access-new",
      refresh_token: "refresh-new",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "leads:read",
    });
    const lock = serialLock();
    const options = {
      config: CONFIG,
      repository: credentials.value,
      http,
      fetch: vi.fn(async () => jsonResponse({ ok: true })),
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      withCredentialLock: lock,
      lockPath: "/tmp/mochi.lock",
    };

    await Promise.all([
      new AuthenticatedClient(options).get("/v1/leads/"),
      new AuthenticatedClient(options).get("/v1/leads/"),
    ]);

    expect(http.postForm).toHaveBeenCalledOnce();
    expect(options.fetch).toHaveBeenCalledTimes(2);
  });

  test("preserves the old bundle when refresh succeeds with malformed data", async () => {
    const old = bundle({ accessExpiresAt: "2026-08-25T12:00:30.000Z" });
    const credentials = repository(old);
    const http = oauthHttp({ access_token: "partial-secret" });
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http,
      fetch: vi.fn(),
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    await expect(client.get("/v1/leads/")).rejects.toMatchObject({ code: "OAUTH_TOKEN_INVALID" });
    expect(credentials.stored).toEqual(old);
    expect(credentials.value.setCredentials).not.toHaveBeenCalled();
  });

  test("rejects an out-of-range refresh expiry without replacing credentials", async () => {
    const old = bundle({ accessExpiresAt: "2026-08-25T12:00:30.000Z" });
    const credentials = repository(old);
    const http = oauthHttp({
      access_token: "access-new",
      refresh_token: "refresh-new",
      token_type: "Bearer",
      expires_in: Number.MAX_SAFE_INTEGER,
      scope: "leads:read",
    });
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http,
      fetch: vi.fn(),
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    await expect(client.get("/v1/leads/")).rejects.toMatchObject({ code: "OAUTH_TOKEN_INVALID" });
    expect(credentials.stored).toEqual(old);
  });

  test("preserves the old bundle and does not retry a failed refresh mutation", async () => {
    const old = bundle({ accessExpiresAt: "2026-08-25T12:00:30.000Z" });
    const credentials = repository(old);
    const http = oauthHttp();
    vi.mocked(http.postForm).mockRejectedValueOnce(new Error("network failure containing refresh-old"));
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http,
      fetch: vi.fn(),
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    const failure = await client.get("/v1/leads/").catch((error: unknown) => error);

    expect(http.postForm).toHaveBeenCalledOnce();
    expect(credentials.stored).toEqual(old);
    expect(credentials.value.setCredentials).not.toHaveBeenCalled();
    expect(String(failure)).not.toContain("refresh-old");
    expect(failure).toMatchObject({ code: "OAUTH_REFRESH_FAILED" });
  });

  test("a 401 forces one refresh and retries GET only once", async () => {
    const credentials = repository(bundle());
    const http = oauthHttp({
      access_token: "access-new",
      refresh_token: "refresh-new",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "leads:read",
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ detail: "expired access-old refresh-old" }, 401, { "x-request-id": "access-old" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: "still unauthorized access-old refresh-old access-new refresh-new",
            nested: [{ authorization: "Bearer access-new" }, "refresh-new"],
            "access-new": "refresh-old",
          },
          401,
          { "x-request-id": "request-access-old-refresh-new", "retry-after": "refresh-old" },
        ),
      );
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http,
      fetch,
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    await expect(client.get("/v1/leads/")).resolves.toEqual({
      status: 401,
      body: {
        detail: "still unauthorized [redacted] [redacted] [redacted] [redacted]",
        nested: [{ authorization: "Bearer [redacted]" }, "[redacted]"],
        "[redacted]": "[redacted]",
      },
      requestId: "request-[redacted]-[redacted]",
      retryAfter: "[redacted]",
    });
    expect(http.postForm).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer access-new");
  });

  test("a 401 reuses another process's rotation without a duplicate refresh", async () => {
    const credentials = repository(bundle());
    const http = oauthHttp();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const token = new Headers(init?.headers).get("authorization");
      if (fetch.mock.calls.length === 1) {
        await credentials.value.setCredentials(
          bundle({
            accessToken: "access-other",
            refreshToken: "refresh-other",
            accessExpiresAt: "2026-08-25T14:00:00.000Z",
          }),
        );
        return jsonResponse({ detail: "expired" }, 401);
      }
      expect(token).toBe("Bearer access-other");
      return jsonResponse({ ok: true });
    });
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http,
      fetch,
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    await expect(client.get("/v1/leads/")).resolves.toMatchObject({ status: 200, body: { ok: true } });
    expect(http.postForm).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("returns bounded text and only allowlisted response metadata", async () => {
    const credentials = repository(bundle());
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http: oauthHttp(),
      fetch: vi.fn(
        async () =>
          new Response("temporarily unavailable for access-old and refresh-old", {
            status: 429,
            headers: {
              "x-request-id": "req-access-old",
              "retry-after": "refresh-old",
              "set-cookie": "secret-cookie=value",
              authorization: "Bearer server-secret",
            },
          }),
      ),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    const result = await client.get("/v1/leads/");

    expect(result).toEqual({
      status: 429,
      body: "temporarily unavailable for [redacted] and [redacted]",
      requestId: "req-[redacted]",
      retryAfter: "[redacted]",
    });
    expect(JSON.stringify(result)).not.toMatch(/cookie|server-secret|authorization/u);
  });

  test("omits oversized request metadata", async () => {
    const credentials = repository(bundle({ accessToken: "r", refreshToken: "s" }));
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http: oauthHttp(),
      fetch: vi.fn(async () =>
        jsonResponse({ ok: true }, 429, { "x-request-id": "r".repeat(200), "retry-after": "s".repeat(200) }),
      ),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    await expect(client.get("/v1/leads/")).resolves.toEqual({ status: 429, body: { ok: true } });
  });

  test.each([
    "https://evil.example/v1/leads/",
    "//evil.example/v1/leads/",
    "/v1/../admin/",
    "/v1/%2e%2e/admin/",
    "/v1/%252e%252e/admin/",
    "/v1/%2f%2fevil.example/",
    "/v1/leads/#fragment",
    "/v1\\@evil.example/",
  ])("rejects unsafe raw target %s before credential loading", async (target) => {
    const credentials = repository(bundle());
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http: oauthHttp(),
      fetch: vi.fn(),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    await expect(client.get(target)).rejects.toMatchObject({ code: "API_TARGET_INVALID" });
    expect(credentials.value.getCredentials).not.toHaveBeenCalled();
  });

  test("allows encoded slash, percent, and backslash values in the query only", async () => {
    const credentials = repository(bundle());
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ ok: true }));
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http: oauthHttp(),
      fetch,
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });
    const query = new URLSearchParams({ slash: "a/b", percent: "10%", backslash: "a\\b" });

    await expect(client.get(`/v1/leads/?${query.toString()}`)).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.themochi.app/v1/leads/?slash=a%2Fb&percent=10%25&backslash=a%5Cb",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("bounds response reads incrementally and does not expose bearer material in the error", async () => {
    const credentials = repository(bundle());
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(400_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http: oauthHttp(),
      fetch: vi.fn(async () => new Response(stream)),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    const failure = await client.get("/v1/leads/").catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "API_RESPONSE_TOO_LARGE" });
    expect(JSON.stringify(failure)).not.toContain("access-old");
    expect(cancelled).toBe(true);
  });

  test("redacts response stream failures", async () => {
    const credentials = repository(bundle());
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("stream failed with Bearer access-old");
      },
    });
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http: oauthHttp(),
      fetch: vi.fn(async () => new Response(stream)),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    const failure = await client.get("/v1/leads/").catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "API_NETWORK_ERROR", exitCode: 5 });
    expect(String(failure)).not.toContain("access-old");
  });

  test("does not trust a CliError thrown by an untrusted response stream", async () => {
    const credentials = repository(bundle());
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new CliError("UNTRUSTED", "stream leaked refresh-old", ExitCode.Api);
      },
    });
    const client = new AuthenticatedClient({
      config: CONFIG,
      repository: credentials.value,
      http: oauthHttp(),
      fetch: vi.fn(async () => new Response(stream)),
      withCredentialLock: serialLock(),
      lockPath: "/tmp/mochi.lock",
    });

    const failure = await client.get("/v1/leads/").catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "API_NETWORK_ERROR", exitCode: 5 });
    expect(String(failure)).not.toContain("refresh-old");
  });
});
