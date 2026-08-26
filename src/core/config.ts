import { CliError, ExitCode } from "./errors.js";

const DEFAULT_API_BASE_URL = "https://api.themochi.app";
const DEFAULT_ISSUER_URL = "https://api.themochi.app";
const DEFAULT_OPENAPI_URL = "https://openapi.gitbook.com/o/bpgVa93BfrzaqXzuggv8/spec/mochi-api.json";

export interface RuntimeConfig {
  apiBaseUrl: string;
  issuerUrl: string;
  openapiUrl: string;
}

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function loadRuntimeConfig(environment: RuntimeEnvironment = process.env): RuntimeConfig {
  const config = {
    apiBaseUrl: parseBaseUrl(environment.MOCHI_API_URL ?? DEFAULT_API_BASE_URL, "API base", true),
    issuerUrl: parseBaseUrl(environment.MOCHI_ISSUER_URL ?? DEFAULT_ISSUER_URL, "issuer base", false),
    openapiUrl: parseEndpointUrl(environment.MOCHI_OPENAPI_URL ?? DEFAULT_OPENAPI_URL, "OpenAPI URL"),
  };
  assertOriginBoundRuntimeConfig(config);
  return config;
}

export function assertOriginBoundRuntimeConfig(config: Pick<RuntimeConfig, "apiBaseUrl" | "issuerUrl">): void {
  let apiOrigin: string;
  let issuerOrigin: string;
  try {
    apiOrigin = new URL(config.apiBaseUrl).origin;
    issuerOrigin = new URL(config.issuerUrl).origin;
  } catch {
    throw invalidOriginPair();
  }
  if (apiOrigin !== issuerOrigin) {
    throw invalidOriginPair();
  }
}

function parseBaseUrl(value: string, label: string, rejectPath: boolean): string {
  const url = parseUrl(value, label);

  if (!isSecureOrLoopback(url)) {
    throw new Error(`${label} must use HTTPS, except for a loopback HTTP URL.`);
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new Error(`${label} must not include credentials, a query, or a fragment.`);
  }
  if (rejectPath && !/^\/+$/u.test(url.pathname)) {
    throw new Error("API base must not include a path.");
  }

  return trimTrailingSlashes(url.toString());
}

function parseEndpointUrl(value: string, label: string): string {
  const url = parseUrl(value, label);

  if (!isSecureOrLoopback(url)) {
    throw new Error(`${label} must use HTTPS, except for a loopback HTTP URL.`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} must not include credentials or a fragment.`);
  }

  return url.toString();
}

function parseUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
}

function isSecureOrLoopback(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname));
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function invalidOriginPair(): CliError {
  return new CliError("CONFIG_INVALID", "The Mochi API base and OAuth issuer must share one origin.", ExitCode.Local);
}
