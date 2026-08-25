import { CliError, ExitCode } from "../core/errors.js";
import type { OAuthHttp, OAuthMetadata } from "./types.js";

const PRODUCTION_API_ORIGIN = "https://api.themochi.app";
const PRODUCTION_APP_ORIGIN = "https://use.themochi.app";

export interface DiscoverOAuthOptions {
  issuerUrl: string;
  http: OAuthHttp;
}

export async function discoverOAuth({ issuerUrl, http }: DiscoverOAuthOptions): Promise<OAuthMetadata> {
  const expectedIssuer = normalizeIssuer(issuerUrl);
  const response = await http.getJson(`${expectedIssuer}/.well-known/oauth-authorization-server`);
  if (response.status !== 200) {
    throw new CliError("OAUTH_DISCOVERY_FAILED", "Mochi OAuth discovery is currently unavailable.", ExitCode.OAuth);
  }

  const metadata = decodeMetadata(response.body, expectedIssuer);
  if (!metadata) {
    throw invalidDiscovery();
  }
  return metadata;
}

function decodeMetadata(value: unknown, expectedIssuer: string): OAuthMetadata | null {
  if (!isRecord(value) || value.issuer !== expectedIssuer) {
    return null;
  }

  const issuer = parseEndpoint(value.issuer, expectedIssuer, "issuer");
  const authorizationEndpoint = parseEndpoint(value.authorization_endpoint, expectedIssuer, "authorization");
  const tokenEndpoint = parseEndpoint(value.token_endpoint, expectedIssuer, "server");
  const registrationEndpoint = parseEndpoint(value.registration_endpoint, expectedIssuer, "server");
  const revocationEndpoint = parseEndpoint(value.revocation_endpoint, expectedIssuer, "server");
  if (!issuer || !authorizationEndpoint || !tokenEndpoint || !registrationEndpoint || !revocationEndpoint) {
    return null;
  }
  if (
    !hasValue(value.response_types_supported, "code") ||
    !hasValue(value.grant_types_supported, "authorization_code") ||
    !hasValue(value.grant_types_supported, "refresh_token") ||
    !hasValue(value.code_challenge_methods_supported, "S256") ||
    !hasValue(value.token_endpoint_auth_methods_supported, "none")
  ) {
    return null;
  }

  return {
    issuer: issuer.toString().replace(/\/$/u, ""),
    authorizationEndpoint: authorizationEndpoint.toString(),
    tokenEndpoint: tokenEndpoint.toString(),
    registrationEndpoint: registrationEndpoint.toString(),
    revocationEndpoint: revocationEndpoint.toString(),
  };
}

function parseEndpoint(
  value: unknown,
  expectedIssuer: string,
  role: "issuer" | "authorization" | "server",
): URL | null {
  if (typeof value !== "string") {
    return null;
  }
  let endpoint: URL;
  let issuer: URL;
  try {
    endpoint = new URL(value);
    issuer = new URL(expectedIssuer);
  } catch {
    return null;
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    return null;
  }

  const issuerIsLoopback = issuer.protocol === "http:" && isLoopback(issuer.hostname);
  if (
    endpoint.protocol !== "https:" &&
    !(issuerIsLoopback && endpoint.protocol === "http:" && isLoopback(endpoint.hostname))
  ) {
    return null;
  }

  if (endpoint.origin === issuer.origin) {
    return endpoint;
  }
  if (
    role === "authorization" &&
    issuer.origin === PRODUCTION_API_ORIGIN &&
    endpoint.origin === PRODUCTION_APP_ORIGIN
  ) {
    return endpoint;
  }
  return null;
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/u, "");
}

function hasValue(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.includes(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function invalidDiscovery(): CliError {
  return new CliError(
    "OAUTH_DISCOVERY_INVALID",
    "Mochi OAuth discovery returned unsafe or unsupported metadata.",
    ExitCode.OAuth,
  );
}
