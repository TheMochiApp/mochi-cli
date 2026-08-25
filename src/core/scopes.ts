import { CliError, ExitCode } from "./errors.js";

export const READ_SCOPES = [
  "analytics:read",
  "bookings:read",
  "config:read",
  "leads:read",
  "revenue:read",
  "signals:read",
  "team:read",
] as const;

export type ReadScope = (typeof READ_SCOPES)[number];

const READ_SCOPE_SET: ReadonlySet<string> = new Set(READ_SCOPES);

export function isReadScope(value: unknown): value is ReadScope {
  return typeof value === "string" && READ_SCOPE_SET.has(value);
}

export function normalizeReadScopes(values: readonly string[]): ReadScope[] {
  const requested = values.length === 0 ? ["leads:read"] : values;
  const normalized = requested.map((scope) => scope.trim());
  if (normalized.some((scope) => !isReadScope(scope))) {
    throw new CliError(
      "OAUTH_SCOPE_INVALID",
      "Only documented read-only Mochi scopes may be requested.",
      ExitCode.Usage,
    );
  }
  return [...new Set(normalized)].sort() as ReadScope[];
}
