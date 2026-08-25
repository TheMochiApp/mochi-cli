import { CliError, ExitCode } from "../core/errors.js";
import type { CredentialRepository, PublicClientRecord } from "../storage/types.js";
import type { OAuthHttp, OAuthMetadata } from "./types.js";

export const LOOPBACK_REDIRECT_URIS = Object.freeze(
  [48151, 48152, 48153, 48154, 48155].map((port) => `http://127.0.0.1:${port}/callback`),
);

const EXPECTED_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
const EXPECTED_RESPONSE_TYPES = ["code"] as const;

export interface EnsurePublicClientOptions {
  metadata: OAuthMetadata;
  http: OAuthHttp;
  repository: CredentialRepository;
}

export async function ensurePublicClient({
  metadata,
  http,
  repository,
}: EnsurePublicClientOptions): Promise<PublicClientRecord> {
  const saved = await repository.getClientRecord();
  if (saved && isCurrentClient(saved, metadata.registrationEndpoint)) {
    return saved;
  }

  const response = await http.postJson(metadata.registrationEndpoint, {
    client_name: "Mochi Agent CLI",
    redirect_uris: LOOPBACK_REDIRECT_URIS,
    token_endpoint_auth_method: "none",
    grant_types: EXPECTED_GRANT_TYPES,
    response_types: EXPECTED_RESPONSE_TYPES,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new CliError(
      "OAUTH_REGISTRATION_FAILED",
      "Mochi could not register this CLI for browser authorization.",
      ExitCode.OAuth,
    );
  }

  const clientId = decodeRegistrationResponse(response.body);
  if (!clientId) {
    throw new CliError(
      "OAUTH_REGISTRATION_INVALID",
      "Mochi returned an invalid public-client registration.",
      ExitCode.OAuth,
    );
  }
  const client: PublicClientRecord = {
    clientId,
    redirectUris: [...LOOPBACK_REDIRECT_URIS],
    registrationEndpoint: metadata.registrationEndpoint,
  };
  await repository.setClientRecord(client);
  return client;
}

function isCurrentClient(record: PublicClientRecord, registrationEndpoint: string): boolean {
  return (
    record.registrationEndpoint === registrationEndpoint && sameStringSet(record.redirectUris, LOOPBACK_REDIRECT_URIS)
  );
}

function decodeRegistrationResponse(value: unknown): string | null {
  if (!isRecord(value) || !isNonEmptyString(value.client_id) || "client_secret" in value) {
    return null;
  }
  if (
    value.token_endpoint_auth_method !== "none" ||
    !sameStringSet(value.redirect_uris, LOOPBACK_REDIRECT_URIS) ||
    !sameStringSet(value.grant_types, EXPECTED_GRANT_TYPES) ||
    !sameStringSet(value.response_types, EXPECTED_RESPONSE_TYPES)
  ) {
    return null;
  }
  return value.client_id;
}

function sameStringSet(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === expected.length &&
    expected.every((item) => value.includes(item))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
