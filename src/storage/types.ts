export const PUBLIC_API_RESOURCE = "https://api.themochi.app/v1/" as const;

const READ_SCOPES = new Set([
  "analytics:read",
  "bookings:read",
  "config:read",
  "leads:read",
  "revenue:read",
  "signals:read",
  "team:read",
]);

export interface CredentialBundle {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  scopes: string[];
  resource: typeof PUBLIC_API_RESOURCE;
  clientId: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  apiBaseUrl: string;
}

export interface PublicClientRecord {
  clientId: string;
  redirectUris: string[];
  registrationEndpoint: string;
}

export interface SecretStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}

export type CredentialBackend = "keyring" | "file-0600";

export interface CredentialRepository {
  readonly backend: CredentialBackend;
  getCredentials(): Promise<CredentialBundle | null>;
  setCredentials(bundle: CredentialBundle): Promise<void>;
  deleteCredentials(): Promise<void>;
  getClientRecord(): Promise<PublicClientRecord | null>;
  setClientRecord(record: PublicClientRecord): Promise<void>;
  deleteClientRecord(): Promise<void>;
}

const CREDENTIAL_KEYS = [
  "accessToken",
  "refreshToken",
  "accessExpiresAt",
  "scopes",
  "resource",
  "clientId",
  "tokenEndpoint",
  "revocationEndpoint",
  "apiBaseUrl",
] as const;

const CLIENT_KEYS = ["clientId", "redirectUris", "registrationEndpoint"] as const;

export function decodeCredentialBundle(value: unknown): CredentialBundle | null {
  if (!hasExactKeys(value, CREDENTIAL_KEYS)) {
    return null;
  }

  const candidate = value as Record<(typeof CREDENTIAL_KEYS)[number], unknown>;
  if (
    !isNonEmptyString(candidate.accessToken) ||
    !isNonEmptyString(candidate.refreshToken) ||
    !isAbsoluteExpiry(candidate.accessExpiresAt) ||
    !isReadScopeList(candidate.scopes) ||
    candidate.resource !== PUBLIC_API_RESOURCE ||
    !isNonEmptyString(candidate.clientId) ||
    !isSecureEndpoint(candidate.tokenEndpoint, false) ||
    !isSecureEndpoint(candidate.revocationEndpoint, false) ||
    !isSecureEndpoint(candidate.apiBaseUrl, true)
  ) {
    return null;
  }

  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    accessExpiresAt: candidate.accessExpiresAt,
    scopes: [...candidate.scopes],
    resource: candidate.resource,
    clientId: candidate.clientId,
    tokenEndpoint: candidate.tokenEndpoint,
    revocationEndpoint: candidate.revocationEndpoint,
    apiBaseUrl: candidate.apiBaseUrl,
  };
}

export function decodePublicClientRecord(value: unknown): PublicClientRecord | null {
  if (!hasExactKeys(value, CLIENT_KEYS)) {
    return null;
  }

  const candidate = value as Record<(typeof CLIENT_KEYS)[number], unknown>;
  if (
    !isNonEmptyString(candidate.clientId) ||
    !isLoopbackRedirectList(candidate.redirectUris) ||
    !isSecureEndpoint(candidate.registrationEndpoint, false)
  ) {
    return null;
  }

  return {
    clientId: candidate.clientId,
    redirectUris: [...candidate.redirectUris],
    registrationEndpoint: candidate.registrationEndpoint,
  };
}

function hasExactKeys<const Key extends string>(
  value: unknown,
  expectedKeys: readonly Key[],
): value is Record<Key, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    [...expectedKeys].sort().every((key, index) => key === actualKeys[index])
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAbsoluteExpiry(value: unknown): value is string {
  return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
}

function isReadScopeList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((scope) => typeof scope === "string" && READ_SCOPES.has(scope)) &&
    new Set(value).size === value.length
  );
}

function isSecureEndpoint(value: unknown, requireRootPath: boolean): value is string {
  if (typeof value !== "string") {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const secure = url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname));
  const rootPath = !requireRootPath || /^\/*$/u.test(url.pathname);
  return secure && rootPath && !url.username && !url.password && !url.search && !url.hash;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isLoopbackRedirectList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every((redirectUri) => {
      if (typeof redirectUri !== "string") {
        return false;
      }
      try {
        const url = new URL(redirectUri);
        return (
          url.protocol === "http:" &&
          url.hostname === "127.0.0.1" &&
          url.pathname === "/callback" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    })
  );
}
