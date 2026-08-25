import { describe, expect, test, vi } from "vitest";

import type { CredentialRepository, PublicClientRecord } from "../../src/storage/types.js";
import { LOOPBACK_REDIRECT_URIS, ensurePublicClient } from "../../src/oauth/client-registration.js";
import type { OAuthHttp, OAuthMetadata } from "../../src/oauth/types.js";

const METADATA: OAuthMetadata = {
  issuer: "https://api.themochi.app",
  authorizationEndpoint: "https://api.themochi.app/api/zapier/oauth/authorize/",
  tokenEndpoint: "https://api.themochi.app/api/zapier/oauth/token/",
  registrationEndpoint: "https://api.themochi.app/api/zapier/oauth/register/",
  revocationEndpoint: "https://api.themochi.app/api/zapier/oauth/revoke/",
};

function repository(savedClient: PublicClientRecord | null = null): CredentialRepository {
  return {
    backend: "file-0600",
    getCredentials: vi.fn(async () => null),
    setCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
    getClientRecord: vi.fn(async () => savedClient),
    setClientRecord: vi.fn(),
    deleteClientRecord: vi.fn(),
  };
}

function http(body: unknown, status = 201): OAuthHttp {
  return {
    getJson: vi.fn(),
    postJson: vi.fn(async () => ({ status, body })),
    postForm: vi.fn(),
  };
}

describe("dynamic client registration", () => {
  test("reuses the valid client for the current endpoint without registering", async () => {
    const savedClient: PublicClientRecord = {
      clientId: "saved-client",
      redirectUris: [...LOOPBACK_REDIRECT_URIS],
      registrationEndpoint: METADATA.registrationEndpoint,
    };
    const credentials = repository(savedClient);
    const oauthHttp = http({});

    await expect(ensurePublicClient({ metadata: METADATA, http: oauthHttp, repository: credentials })).resolves.toEqual(
      savedClient,
    );
    expect(oauthHttp.postJson).not.toHaveBeenCalled();
  });

  test("registers one public client with exactly five fixed callbacks", async () => {
    const credentials = repository();
    const oauthHttp = http({
      client_id: "new-client",
      redirect_uris: [...LOOPBACK_REDIRECT_URIS].reverse(),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });

    const client = await ensurePublicClient({ metadata: METADATA, http: oauthHttp, repository: credentials });

    expect(LOOPBACK_REDIRECT_URIS).toEqual([
      "http://127.0.0.1:48151/callback",
      "http://127.0.0.1:48152/callback",
      "http://127.0.0.1:48153/callback",
      "http://127.0.0.1:48154/callback",
      "http://127.0.0.1:48155/callback",
    ]);
    expect(oauthHttp.postJson).toHaveBeenCalledWith(METADATA.registrationEndpoint, {
      client_name: "Mochi Agent CLI",
      redirect_uris: LOOPBACK_REDIRECT_URIS,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(client).toEqual({
      clientId: "new-client",
      redirectUris: LOOPBACK_REDIRECT_URIS,
      registrationEndpoint: METADATA.registrationEndpoint,
    });
    expect(credentials.setClientRecord).toHaveBeenCalledWith(client);
  });

  test.each([
    ["different redirects", { client_id: "client", redirect_uris: LOOPBACK_REDIRECT_URIS.slice(0, 4) }],
    ["a client secret", { client_id: "client", redirect_uris: LOOPBACK_REDIRECT_URIS, client_secret: "secret" }],
    [
      "confidential auth",
      {
        client_id: "client",
        redirect_uris: LOOPBACK_REDIRECT_URIS,
        token_endpoint_auth_method: "client_secret_post",
      },
    ],
    ["an empty client id", { client_id: "", redirect_uris: LOOPBACK_REDIRECT_URIS }],
  ])("rejects a registration response containing %s", async (_name, body) => {
    const credentials = repository();

    const failure = await ensurePublicClient({ metadata: METADATA, http: http(body), repository: credentials }).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ code: "OAUTH_REGISTRATION_INVALID" });
    expect(String(failure)).not.toContain("secret");
    expect(credentials.setClientRecord).not.toHaveBeenCalled();
  });

  test("does not expose an error response body", async () => {
    const failure = await ensurePublicClient({
      metadata: METADATA,
      http: http({ refresh_token: "must-not-leak" }, 429),
      repository: repository(),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "OAUTH_REGISTRATION_FAILED" });
    expect(String(failure)).not.toContain("must-not-leak");
  });
});
