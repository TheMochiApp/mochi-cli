import type { RuntimeConfig } from "../core/config.js";
import { CliError, ExitCode } from "../core/errors.js";
import type { OAuthHttp, OAuthHttpResponse } from "../oauth/types.js";
import { withCredentialLock as acquireCredentialLock } from "../storage/lock.js";
import { resolveStoragePaths } from "../storage/paths.js";
import { PUBLIC_API_RESOURCE, type CredentialBundle, type CredentialRepository } from "../storage/types.js";
import type { ApiResponse } from "./types.js";

const REFRESH_WINDOW_MS = 60_000;
const API_TIMEOUT_MS = 15_000;
const MAX_API_RESPONSE_BYTES = 1024 * 1024;
const MAX_API_METADATA_LENGTH = 256;
const READ_SCOPES = new Set([
  "analytics:read",
  "bookings:read",
  "config:read",
  "leads:read",
  "revenue:read",
  "signals:read",
  "team:read",
]);

export interface CredentialLock {
  <Result>(lockPath: string, callback: () => Promise<Result>): Promise<Result>;
}

export interface AuthenticatedClientOptions {
  config: RuntimeConfig;
  repository: CredentialRepository;
  http: OAuthHttp;
  fetch?: typeof fetch;
  now?: () => Date;
  lockPath?: string;
  withCredentialLock?: CredentialLock;
}

export class AuthenticatedClient {
  readonly #config: RuntimeConfig;
  readonly #repository: CredentialRepository;
  readonly #http: OAuthHttp;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #lockPath: string;
  readonly #withCredentialLock: CredentialLock;

  constructor(options: AuthenticatedClientOptions) {
    this.#config = options.config;
    this.#repository = options.repository;
    this.#http = options.http;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
    this.#lockPath = options.lockPath ?? resolveStoragePaths().lockPath;
    this.#withCredentialLock = options.withCredentialLock ?? acquireCredentialLock;
  }

  async get(target: string): Promise<ApiResponse> {
    const url = validateTarget(target, this.#config.apiBaseUrl);
    const loaded = await this.#repository.getCredentials();
    if (!loaded) throw authenticationRequired();

    const current = await this.#ensureFresh(loaded);
    const first = await this.#request(url, current.accessToken);
    if (first.status !== 401) return first;

    const retriedBundle = await this.#ensureFresh(current, true);
    return await this.#request(url, retriedBundle.accessToken);
  }

  async #ensureFresh(bundle: CredentialBundle, force = false): Promise<CredentialBundle> {
    if (!force && !expiresWithinWindow(bundle, this.#now())) return bundle;

    return await this.#withCredentialLock(this.#lockPath, async () => {
      const reloaded = await this.#repository.getCredentials();
      if (!reloaded) throw authenticationRequired();

      if (reloaded.accessToken !== bundle.accessToken && !expiresWithinWindow(reloaded, this.#now())) {
        return reloaded;
      }
      if (!force && !expiresWithinWindow(reloaded, this.#now())) return reloaded;

      let response: OAuthHttpResponse;
      try {
        response = await this.#http.postForm(
          reloaded.tokenEndpoint,
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: reloaded.refreshToken,
            client_id: reloaded.clientId,
            resource: PUBLIC_API_RESOURCE,
          }),
        );
      } catch {
        throw new CliError("OAUTH_REFRESH_FAILED", "Mochi could not refresh this login.", ExitCode.Network);
      }
      if (response.status !== 200) {
        throw new CliError("OAUTH_REFRESH_FAILED", "Mochi could not refresh this login.", ExitCode.OAuth);
      }

      const rotated = decodeRefreshBundle(response.body, reloaded, this.#now());
      if (!rotated) {
        throw new CliError("OAUTH_TOKEN_INVALID", "Mochi returned an invalid OAuth token response.", ExitCode.OAuth);
      }
      await this.#repository.setCredentials(rotated);
      return rotated;
    });
  }

  async #request(url: URL, accessToken: string): Promise<ApiResponse> {
    let response: Response;
    try {
      response = await this.#fetch(url.toString(), {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch {
      throw new CliError("API_NETWORK_ERROR", "Could not reach the Mochi API.", ExitCode.Network);
    }

    const body = await readApiBody(response.body);
    const result: ApiResponse = { status: response.status, body };
    const requestId = safeResponseHeader(response.headers, "x-request-id");
    const retryAfter = safeResponseHeader(response.headers, "retry-after");
    if (requestId !== null) result.requestId = requestId;
    if (retryAfter !== null) result.retryAfter = retryAfter;
    return result;
  }
}

function validateTarget(target: string, apiBaseUrl: string): URL {
  if (
    !target.startsWith("/v1/") ||
    target.startsWith("//") ||
    target.includes("\\") ||
    /%(?:2e|2f|5c|25)/iu.test(target)
  ) {
    throw invalidTarget();
  }

  let url: URL;
  let base: URL;
  try {
    base = new URL(apiBaseUrl);
    url = new URL(target, base);
  } catch {
    throw invalidTarget();
  }
  if (
    url.origin !== base.origin ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    !url.pathname.startsWith("/v1/")
  ) {
    throw invalidTarget();
  }
  return url;
}

async function readApiBody(body: ReadableStream<Uint8Array> | null): Promise<unknown> {
  if (body === null) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_API_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new CliError("API_RESPONSE_TOO_LARGE", "The Mochi API response was too large.", ExitCode.Api);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("API_RESPONSE_INVALID", "The Mochi API returned an invalid response.", ExitCode.Api);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CliError("API_RESPONSE_INVALID", "The Mochi API returned an invalid response.", ExitCode.Api);
  }
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function decodeRefreshBundle(value: unknown, current: CredentialBundle, now: Date): CredentialBundle | null {
  if (!isRecord(value)) return null;
  if (
    !isSecret(value.access_token) ||
    !isSecret(value.refresh_token) ||
    typeof value.token_type !== "string" ||
    value.token_type.toLowerCase() !== "bearer" ||
    typeof value.expires_in !== "number" ||
    !Number.isInteger(value.expires_in) ||
    value.expires_in <= 0 ||
    !isExactScopeResponse(value.scope, current.scopes) ||
    (value.resource !== undefined && value.resource !== current.resource)
  ) {
    return null;
  }
  const expiresAt = now.getTime() + value.expires_in * 1000;
  if (!Number.isFinite(expiresAt)) return null;
  const expiry = new Date(expiresAt);
  if (!Number.isFinite(expiry.getTime())) return null;

  return {
    ...current,
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    accessExpiresAt: expiry.toISOString(),
  };
}

function isExactScopeResponse(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const scopes = value.trim().split(/\s+/u);
  return (
    scopes.every((scope) => READ_SCOPES.has(scope)) &&
    scopes.length === expected.length &&
    new Set(scopes).size === scopes.length &&
    expected.every((scope) => scopes.includes(scope))
  );
}

function expiresWithinWindow(bundle: CredentialBundle, now: Date): boolean {
  return Date.parse(bundle.accessExpiresAt) <= now.getTime() + REFRESH_WINDOW_MS;
}

function isSecret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeResponseHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  return value !== null && value.length <= MAX_API_METADATA_LENGTH ? value : null;
}

function authenticationRequired(): CliError {
  return new CliError("AUTH_REQUIRED", "Run mochi auth login.", ExitCode.Authentication);
}

function invalidTarget(): CliError {
  return new CliError("API_TARGET_INVALID", "Use a relative Mochi API path beginning /v1/.", ExitCode.Usage);
}
