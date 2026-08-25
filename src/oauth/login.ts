import type { RuntimeConfig } from "../core/config.js";
import { CliError, ExitCode } from "../core/errors.js";
import { isReadScope, normalizeReadScopes, type ReadScope } from "../core/scopes.js";
import { withCredentialLock as acquireCredentialLock } from "../storage/lock.js";
import { resolveStoragePaths } from "../storage/paths.js";
import {
  PUBLIC_API_RESOURCE,
  type CredentialBundle,
  type CredentialRepository,
  type PublicClientRecord,
} from "../storage/types.js";
import { openBrowser as launchBrowser } from "./browser.js";
import { ensurePublicClient as registerPublicClient } from "./client-registration.js";
import { discoverOAuth as discoverMetadata } from "./discovery.js";
import { createPkce as generatePkce, type PkceValues } from "./pkce.js";
import { waitForOAuthCallback as receiveCallback, type WaitForOAuthCallbackOptions } from "./callback-server.js";
import type { OAuthCallback, OAuthHttp, OAuthMetadata } from "./types.js";

export { READ_SCOPES } from "../core/scopes.js";

export interface LoginResult {
  authenticated: true;
  scopes: ReadScope[];
  storageBackend: CredentialRepository["backend"];
}

export interface CredentialLock {
  <Result>(lockPath: string, callback: () => Promise<Result>): Promise<Result>;
}

export interface LoginOptions {
  config: RuntimeConfig;
  repository: CredentialRepository;
  http: OAuthHttp;
  readonlyScopes?: readonly string[];
  lockPath?: string;
  now?: () => Date;
  createPkce?: () => PkceValues;
  discoverOAuth?: (options: { issuerUrl: string; http: OAuthHttp }) => Promise<OAuthMetadata>;
  ensurePublicClient?: (options: {
    metadata: OAuthMetadata;
    http: OAuthHttp;
    repository: CredentialRepository;
  }) => Promise<PublicClientRecord>;
  waitForOAuthCallback?: (options: WaitForOAuthCallbackOptions) => Promise<OAuthCallback>;
  openBrowser?: (authorizationUrl: string) => Promise<string | null>;
  withCredentialLock?: CredentialLock;
  stderr?: (message: string) => void;
}

export async function login(options: LoginOptions): Promise<LoginResult> {
  const scopes = normalizeReadScopes(options.readonlyScopes ?? []);
  const metadata = await (options.discoverOAuth ?? discoverMetadata)({
    issuerUrl: options.config.issuerUrl,
    http: options.http,
  });
  const lockPath = options.lockPath ?? resolveStoragePaths().lockPath;
  const withCredentialLock = options.withCredentialLock ?? acquireCredentialLock;
  const client = await withCredentialLock(lockPath, async () => {
    return await (options.ensurePublicClient ?? registerPublicClient)({
      metadata,
      http: options.http,
      repository: options.repository,
    });
  });
  const pkce = (options.createPkce ?? generatePkce)();
  const openBrowser = options.openBrowser ?? launchBrowser;
  const callback = await (options.waitForOAuthCallback ?? receiveCallback)({
    redirectUris: client.redirectUris,
    expectedState: pkce.state,
    onListening: async (redirectUri) => {
      const authorizationUrl = buildAuthorizationUrl(metadata, client.clientId, redirectUri, scopes, pkce);
      const manualUrl = await openBrowser(authorizationUrl);
      if (manualUrl !== null) {
        (options.stderr ?? defaultStderr)(`Open this URL to authorize Mochi:\n${manualUrl}`);
      }
    },
  });

  if (!isValidCallback(callback, client.redirectUris)) {
    throw new CliError("OAUTH_CALLBACK_INVALID", "The OAuth callback request was invalid.", ExitCode.OAuth);
  }

  await withCredentialLock(lockPath, async () => {
    const response = await options.http.postForm(
      metadata.tokenEndpoint,
      new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.code,
        redirect_uri: callback.redirectUri,
        client_id: client.clientId,
        code_verifier: pkce.verifier,
        resource: PUBLIC_API_RESOURCE,
      }),
    );
    if (response.status !== 200) {
      throw new CliError(
        "OAUTH_TOKEN_EXCHANGE_FAILED",
        "Mochi could not complete the OAuth token exchange.",
        ExitCode.OAuth,
      );
    }

    const bundle = decodeTokenBundle(
      response.body,
      scopes,
      client.clientId,
      metadata,
      options.config,
      options.now?.() ?? new Date(),
    );
    if (!bundle) {
      throw new CliError("OAUTH_TOKEN_INVALID", "Mochi returned an invalid OAuth token response.", ExitCode.OAuth);
    }
    await options.repository.setCredentials(bundle);
  });

  return { authenticated: true, scopes, storageBackend: options.repository.backend };
}

function buildAuthorizationUrl(
  metadata: OAuthMetadata,
  clientId: string,
  redirectUri: string,
  scopes: readonly ReadScope[],
  pkce: PkceValues,
): string {
  const url = new URL(metadata.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    resource: PUBLIC_API_RESOURCE,
    scope: scopes.join(" "),
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

function decodeTokenBundle(
  value: unknown,
  requestedScopes: readonly ReadScope[],
  clientId: string,
  metadata: OAuthMetadata,
  config: RuntimeConfig,
  now: Date,
): CredentialBundle | null {
  if (!isRecord(value)) return null;
  if (
    !isSecret(value.access_token) ||
    !isSecret(value.refresh_token) ||
    typeof value.token_type !== "string" ||
    value.token_type.toLowerCase() !== "bearer" ||
    typeof value.expires_in !== "number" ||
    !Number.isInteger(value.expires_in) ||
    value.expires_in <= 0 ||
    !isExactScopeResponse(value.scope, requestedScopes) ||
    (value.resource !== undefined && value.resource !== PUBLIC_API_RESOURCE)
  ) {
    return null;
  }

  const nowMilliseconds = now.getTime();
  const expiryMilliseconds = nowMilliseconds + value.expires_in * 1000;
  if (!Number.isFinite(nowMilliseconds) || !Number.isFinite(expiryMilliseconds)) return null;
  const expiry = new Date(expiryMilliseconds);
  if (!Number.isFinite(expiry.getTime())) return null;
  const accessExpiresAt = expiry.toISOString();
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    accessExpiresAt,
    scopes: [...requestedScopes],
    resource: PUBLIC_API_RESOURCE,
    clientId,
    tokenEndpoint: metadata.tokenEndpoint,
    revocationEndpoint: metadata.revocationEndpoint,
    apiBaseUrl: config.apiBaseUrl,
  };
}

function isExactScopeResponse(value: unknown, requestedScopes: readonly ReadScope[]): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const scopes = value.trim().split(/\s+/u);
  return (
    scopes.every(isReadScope) &&
    scopes.length === requestedScopes.length &&
    new Set(scopes).size === scopes.length &&
    requestedScopes.every((scope) => scopes.includes(scope))
  );
}

function isValidCallback(callback: OAuthCallback, redirectUris: readonly string[]): boolean {
  return (
    typeof callback.code === "string" &&
    callback.code.trim().length > 0 &&
    redirectUris.includes(callback.redirectUri) &&
    callback.redirectUri.startsWith("http://127.0.0.1:")
  );
}

function isSecret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
