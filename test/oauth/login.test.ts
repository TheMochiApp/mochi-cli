import { describe, expect, test, vi } from "vitest";

import type { RuntimeConfig } from "../../src/core/config.js";
import type { CredentialRepository, PublicClientRecord } from "../../src/storage/types.js";
import { PUBLIC_API_RESOURCE } from "../../src/storage/types.js";
import { LOOPBACK_REDIRECT_URIS } from "../../src/oauth/client-registration.js";
import { login } from "../../src/oauth/login.js";
import type { OAuthHttp, OAuthMetadata } from "../../src/oauth/types.js";

const CONFIG: RuntimeConfig = {
  apiBaseUrl: "https://api.themochi.app",
  issuerUrl: "https://api.themochi.app",
  openapiUrl: "https://openapi.gitbook.com/o/example/spec/mochi-api.json",
};

const METADATA: OAuthMetadata = {
  issuer: CONFIG.issuerUrl,
  authorizationEndpoint: "https://use.themochi.app/oauth/authorize/",
  tokenEndpoint: "https://api.themochi.app/api/zapier/oauth/token/",
  registrationEndpoint: "https://api.themochi.app/api/zapier/oauth/register/",
  revocationEndpoint: "https://api.themochi.app/api/zapier/oauth/revoke/",
};

const CLIENT: PublicClientRecord = {
  clientId: "public-client-id",
  redirectUris: [...LOOPBACK_REDIRECT_URIS],
  registrationEndpoint: METADATA.registrationEndpoint,
};

function repository(): CredentialRepository {
  return {
    backend: "file-0600",
    getCredentials: vi.fn(async () => null),
    setCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
    getClientRecord: vi.fn(async () => CLIENT),
    setClientRecord: vi.fn(),
    deleteClientRecord: vi.fn(),
  };
}

function tokenHttp(body: unknown, status = 200): OAuthHttp {
  return {
    getJson: vi.fn(),
    postJson: vi.fn(),
    postForm: vi.fn(async () => ({ status, body })),
  };
}

function dependencies(overrides: Readonly<Record<string, unknown>> = {}) {
  const credentials = repository();
  const http = tokenHttp({
    access_token: "access-token-secret",
    refresh_token: "refresh-token-secret",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "team:read leads:read",
  });
  const openedUrls: string[] = [];
  return {
    config: CONFIG,
    repository: credentials,
    http,
    readonlyScopes: ["team:read", "leads:read", "team:read"],
    lockPath: "/tmp/mochi-test-credentials.lock",
    now: () => new Date("2026-08-25T12:00:00.000Z"),
    createPkce: () => ({
      verifier: "pkce-verifier-secret",
      challenge: "pkce-challenge",
      state: "oauth-state",
    }),
    discoverOAuth: vi.fn(async () => METADATA),
    ensurePublicClient: vi.fn(async () => CLIENT),
    waitForOAuthCallback: vi.fn(async (options) => {
      await options.onListening?.(LOOPBACK_REDIRECT_URIS[1] ?? "");
      return { code: "authorization-code-secret", redirectUri: LOOPBACK_REDIRECT_URIS[1] ?? "" };
    }),
    openBrowser: vi.fn(async (url: string) => {
      openedUrls.push(url);
      return null;
    }),
    withCredentialLock: async <Result>(_path: string, callback: () => Promise<Result>) => await callback(),
    stderr: vi.fn(),
    openedUrls,
    ...overrides,
  };
}

describe("OAuth login", () => {
  test("composes exact authorization and one-time token exchange requests", async () => {
    const deps = dependencies();

    const result = await login(deps);

    expect(deps.openedUrls).toHaveLength(1);
    const authorizationUrl = new URL(deps.openedUrls[0] ?? "");
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(METADATA.authorizationEndpoint);
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT.clientId,
      redirect_uri: LOOPBACK_REDIRECT_URIS[1],
      resource: PUBLIC_API_RESOURCE,
      scope: "leads:read team:read",
      state: "oauth-state",
      code_challenge: "pkce-challenge",
      code_challenge_method: "S256",
    });
    expect(deps.http.postForm).toHaveBeenCalledOnce();
    expect(deps.http.postForm).toHaveBeenCalledWith(
      METADATA.tokenEndpoint,
      new URLSearchParams({
        grant_type: "authorization_code",
        code: "authorization-code-secret",
        redirect_uri: LOOPBACK_REDIRECT_URIS[1] ?? "",
        client_id: CLIENT.clientId,
        code_verifier: "pkce-verifier-secret",
        resource: PUBLIC_API_RESOURCE,
      }),
    );
    expect(deps.repository.setCredentials).toHaveBeenCalledWith({
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      accessExpiresAt: "2026-08-25T13:00:00.000Z",
      scopes: ["leads:read", "team:read"],
      resource: PUBLIC_API_RESOURCE,
      clientId: CLIENT.clientId,
      tokenEndpoint: METADATA.tokenEndpoint,
      revocationEndpoint: METADATA.revocationEndpoint,
      apiBaseUrl: CONFIG.apiBaseUrl,
    });
    expect(result).toEqual({ authenticated: true, scopes: ["leads:read", "team:read"], storageBackend: "file-0600" });
    expect(JSON.stringify(result)).not.toMatch(/access-token|refresh-token|authorization-code|pkce-verifier/u);
  });

  test("defaults to leads:read and prints only the safe authorization URL when browser opening fails", async () => {
    const stderr = vi.fn();
    const deps = dependencies({
      readonlyScopes: [],
      stderr,
      openBrowser: vi.fn(async (url: string) => url),
      http: tokenHttp({
        access_token: "access-token-secret",
        refresh_token: "refresh-token-secret",
        token_type: "Bearer",
        expires_in: 60,
        scope: "leads:read",
      }),
    });

    await login(deps);

    expect(stderr).toHaveBeenCalledOnce();
    const displayed = String(stderr.mock.calls[0]?.[0]);
    expect(displayed).toContain("https://use.themochi.app/oauth/authorize/");
    expect(displayed).not.toMatch(/pkce-verifier|access-token|refresh-token|authorization-code/u);
  });

  test("exchanges and persists the credential bundle while holding the credential lease", async () => {
    let lockHeld = false;
    const credentials = repository();
    credentials.setCredentials = vi.fn(async () => {
      expect(lockHeld).toBe(true);
    });
    const withCredentialLock = vi.fn(async <Result>(path: string, callback: () => Promise<Result>) => {
      expect(path).toBe("/tmp/mochi-test-credentials.lock");
      lockHeld = true;
      try {
        return await callback();
      } finally {
        lockHeld = false;
      }
    });
    const deps = dependencies({ repository: credentials, withCredentialLock });

    await login(deps);

    expect(withCredentialLock).toHaveBeenCalledTimes(2);
    expect(credentials.setCredentials).toHaveBeenCalledOnce();
    expect(lockHeld).toBe(false);
  });

  test("serializes first-use DCR without holding the lease across browser interaction", async () => {
    let savedClient: PublicClientRecord | null = null;
    const credentials = repository();
    credentials.getClientRecord = vi.fn(async () => savedClient);
    credentials.setClientRecord = vi.fn(async (record) => {
      savedClient = record;
    });
    const http = tokenHttp({
      access_token: "access-token-secret",
      refresh_token: "refresh-token-secret",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "leads:read",
    });
    http.postJson = vi.fn(async () => ({
      status: 201,
      body: {
        client_id: "race-safe-client",
        redirect_uris: [...LOOPBACK_REDIRECT_URIS],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    }));
    let tail = Promise.resolve();
    let activeLocks = 0;
    let maximumActiveLocks = 0;
    const withCredentialLock = async <Result>(_path: string, callback: () => Promise<Result>) => {
      const predecessor = tail;
      let release: (() => void) | undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await predecessor;
      activeLocks += 1;
      maximumActiveLocks = Math.max(maximumActiveLocks, activeLocks);
      try {
        return await callback();
      } finally {
        activeLocks -= 1;
        release?.();
      }
    };
    let callbackCount = 0;
    const waitForOAuthCallback = vi.fn(async (options) => {
      await withCredentialLock("/tmp/mochi-test-credentials.lock", async () => undefined);
      callbackCount += 1;
      await options.onListening?.(LOOPBACK_REDIRECT_URIS[0] ?? "");
      return {
        code: `authorization-code-${callbackCount}`,
        redirectUri: LOOPBACK_REDIRECT_URIS[0] ?? "",
      };
    });
    const shared = {
      repository: credentials,
      http,
      readonlyScopes: ["leads:read"],
      ensurePublicClient: undefined,
      waitForOAuthCallback,
      withCredentialLock,
    };

    await Promise.all([login(dependencies(shared)), login(dependencies(shared))]);

    expect(http.postJson).toHaveBeenCalledOnce();
    expect(credentials.setClientRecord).toHaveBeenCalledOnce();
    expect(waitForOAuthCallback).toHaveBeenCalledTimes(2);
    expect(http.postForm).toHaveBeenCalledTimes(2);
    expect(maximumActiveLocks).toBe(1);
  });

  test.each([
    ["a write scope", ["leads:write"]],
    ["case-normalized scope escalation", ["LEADS:READ"]],
    ["an empty entry", ["leads:read", ""]],
  ])("rejects %s before starting OAuth", async (_name, readonlyScopes) => {
    const deps = dependencies({ readonlyScopes });

    await expect(login(deps)).rejects.toMatchObject({ code: "OAUTH_SCOPE_INVALID" });
    expect(deps.discoverOAuth).not.toHaveBeenCalled();
    expect(deps.http.postForm).not.toHaveBeenCalled();
  });

  test.each([
    [
      "empty access token",
      {
        access_token: "",
        refresh_token: "refresh",
        token_type: "Bearer",
        expires_in: 60,
        scope: "leads:read team:read",
      },
    ],
    [
      "missing refresh token",
      { access_token: "access", token_type: "Bearer", expires_in: 60, scope: "leads:read team:read" },
    ],
    [
      "non-bearer type",
      {
        access_token: "access",
        refresh_token: "refresh",
        token_type: "MAC",
        expires_in: 60,
        scope: "leads:read team:read",
      },
    ],
    [
      "non-positive expiry",
      {
        access_token: "access",
        refresh_token: "refresh",
        token_type: "Bearer",
        expires_in: 0,
        scope: "leads:read team:read",
      },
    ],
    [
      "out-of-range expiry",
      {
        access_token: "access",
        refresh_token: "refresh",
        token_type: "Bearer",
        expires_in: Number.MAX_SAFE_INTEGER,
        scope: "leads:read team:read",
      },
    ],
    [
      "scope escalation",
      {
        access_token: "access",
        refresh_token: "refresh",
        token_type: "Bearer",
        expires_in: 60,
        scope: "leads:read team:read config:read",
      },
    ],
    [
      "resource mismatch",
      {
        access_token: "access",
        refresh_token: "refresh",
        token_type: "Bearer",
        expires_in: 60,
        scope: "leads:read team:read",
        resource: "https://evil.example/v1/",
      },
    ],
  ])("rejects a token response with %s without storing it", async (_name, body) => {
    const deps = dependencies({ http: tokenHttp(body) });

    const failure = await login(deps).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "OAUTH_TOKEN_INVALID" });
    expect(String(failure)).not.toContain("access");
    expect(deps.repository.setCredentials).not.toHaveBeenCalled();
    expect(deps.http.postForm).toHaveBeenCalledOnce();
  });

  test("does not retry or expose a failed token response", async () => {
    const http = tokenHttp({ access_token: "must-not-leak" }, 500);
    const deps = dependencies({ http });

    const failure = await login(deps).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "OAUTH_TOKEN_EXCHANGE_FAILED" });
    expect(String(failure)).not.toContain("must-not-leak");
    expect(http.postForm).toHaveBeenCalledOnce();
    expect(deps.repository.setCredentials).not.toHaveBeenCalled();
  });
});
