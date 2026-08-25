import { describe, expect, test } from "vitest";

import { isReadScope, READ_SCOPES } from "../../src/core/scopes.js";
import { READ_SCOPES as LOGIN_READ_SCOPES } from "../../src/oauth/login.js";

describe("canonical read scopes", () => {
  test("defines the complete typed allowlist once and preserves the login export", () => {
    expect(READ_SCOPES).toEqual([
      "analytics:read",
      "bookings:read",
      "config:read",
      "leads:read",
      "revenue:read",
      "signals:read",
      "team:read",
    ]);
    expect(LOGIN_READ_SCOPES).toBe(READ_SCOPES);
    expect(READ_SCOPES.every(isReadScope)).toBe(true);
    expect(isReadScope("leads:write")).toBe(false);
  });
});
