import { describe, expect, test, vi } from "vitest";

import { logout } from "../../src/auth/logout.js";
import type { OAuthHttp } from "../../src/oauth/types.js";
import { PUBLIC_API_RESOURCE, type CredentialBundle, type CredentialRepository } from "../../src/storage/types.js";

function bundle(): CredentialBundle {
  return {
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    accessExpiresAt: "2026-08-25T13:00:00.000Z",
    scopes: ["leads:read"],
    resource: PUBLIC_API_RESOURCE,
    clientId: "client-id",
    tokenEndpoint: "https://api.themochi.app/oauth/token/",
    revocationEndpoint: "https://api.themochi.app/oauth/revoke/",
    apiBaseUrl: "https://api.themochi.app",
  };
}

function repository(initial: CredentialBundle | null): CredentialRepository {
  let stored = initial;
  return {
    backend: "file-0600",
    getCredentials: vi.fn(async () => stored),
    setCredentials: vi.fn(async (value) => {
      stored = value;
    }),
    deleteCredentials: vi.fn(async () => {
      stored = null;
    }),
    getClientRecord: vi.fn(async () => null),
    setClientRecord: vi.fn(),
    deleteClientRecord: vi.fn(),
  };
}

function http(status = 200): OAuthHttp {
  return {
    getJson: vi.fn(),
    postJson: vi.fn(),
    postForm: vi.fn(async () => ({ status, body: {} })),
  };
}

const lock = async <Result>(_path: string, callback: () => Promise<Result>): Promise<Result> => await callback();

describe("logout", () => {
  test("revokes the refresh token with client ID before deleting local credentials", async () => {
    const credentials = repository(bundle());
    const oauth = http(204);

    await expect(
      logout({ repository: credentials, http: oauth, lockPath: "/tmp/mochi.lock", withCredentialLock: lock }),
    ).resolves.toEqual({ authenticated: false, revoked: true, storageBackend: "file-0600" });

    expect(oauth.postForm).toHaveBeenCalledWith(
      "https://api.themochi.app/oauth/revoke/",
      new URLSearchParams({ token: "refresh-secret", client_id: "client-id" }),
    );
    expect(credentials.deleteCredentials).toHaveBeenCalledOnce();
  });

  test("keeps local credentials when revocation is not confirmed", async () => {
    const credentials = repository(bundle());

    await expect(
      logout({ repository: credentials, http: http(503), lockPath: "/tmp/mochi.lock", withCredentialLock: lock }),
    ).rejects.toMatchObject({ code: "OAUTH_REVOCATION_FAILED" });
    expect(credentials.deleteCredentials).not.toHaveBeenCalled();
  });

  test("local-only logout skips the network and deletes under the lease", async () => {
    const credentials = repository(bundle());
    const oauth = http();

    await expect(
      logout({
        repository: credentials,
        http: oauth,
        localOnly: true,
        lockPath: "/tmp/mochi.lock",
        withCredentialLock: lock,
      }),
    ).resolves.toEqual({ authenticated: false, revoked: false, storageBackend: "file-0600" });
    expect(oauth.postForm).not.toHaveBeenCalled();
    expect(credentials.deleteCredentials).toHaveBeenCalledOnce();
  });

  test("does not expose the refresh token when remote revocation fails", async () => {
    const credentials = repository(bundle());
    const failure = await logout({
      repository: credentials,
      http: http(400),
      lockPath: "/tmp/mochi.lock",
      withCredentialLock: lock,
    }).catch((error: unknown) => error);

    expect(JSON.stringify(failure)).not.toContain("refresh-secret");
  });

  test("redacts network failures and keeps local credentials", async () => {
    const credentials = repository(bundle());
    const oauth = http();
    vi.mocked(oauth.postForm).mockRejectedValueOnce(new Error("request failed for refresh-secret"));

    const failure = await logout({
      repository: credentials,
      http: oauth,
      lockPath: "/tmp/mochi.lock",
      withCredentialLock: lock,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "OAUTH_REVOCATION_FAILED" });
    expect(String(failure)).not.toContain("refresh-secret");
    expect(credentials.deleteCredentials).not.toHaveBeenCalled();
  });
});
