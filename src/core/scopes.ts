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
