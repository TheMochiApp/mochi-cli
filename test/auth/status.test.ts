import { describe, expect, test, vi } from "vitest";

import { authStatus } from "../../src/auth/status.js";
import { PUBLIC_API_RESOURCE, type CredentialBundle, type CredentialRepository } from "../../src/storage/types.js";

function repository(credentials: CredentialBundle | null): CredentialRepository {
  return {
    backend: "keyring",
    getCredentials: vi.fn(async () => credentials),
    setCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
    getClientRecord: vi.fn(async () => null),
    setClientRecord: vi.fn(),
    deleteClientRecord: vi.fn(),
  };
}

describe("authStatus", () => {
  test("reports unauthenticated storage metadata without secrets", async () => {
    await expect(authStatus({ repository: repository(null) })).resolves.toEqual({
      authenticated: false,
      storageBackend: "keyring",
    });
  });

  test("returns only safe authentication metadata and expiry state", async () => {
    const result = await authStatus({
      repository: repository({
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        accessExpiresAt: "2026-08-25T12:00:00.000Z",
        scopes: ["leads:read", "team:read"],
        resource: PUBLIC_API_RESOURCE,
        clientId: "client-secret-ish",
        tokenEndpoint: "https://api.themochi.app/oauth/token/",
        revocationEndpoint: "https://api.themochi.app/oauth/revoke/",
        apiBaseUrl: "https://api.themochi.app",
      }),
      now: () => new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(result).toEqual({
      authenticated: true,
      scopes: ["leads:read", "team:read"],
      resource: PUBLIC_API_RESOURCE,
      accessExpiresAt: "2026-08-25T12:00:00.000Z",
      expired: true,
      storageBackend: "keyring",
    });
    expect(JSON.stringify(result)).not.toMatch(/access-secret|refresh-secret|client-secret|oauth\/token/u);
  });
});
