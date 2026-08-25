import { describe, expect, test } from "vitest";

import { createPkce, pkceChallenge } from "../../src/oauth/pkce.js";

describe("PKCE", () => {
  test("matches the RFC 7636 S256 test vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  test("generates high-entropy base64url state and verifier values", () => {
    const requestedLengths: number[] = [];
    const generated = createPkce((length) => {
      requestedLengths.push(length);
      return Buffer.alloc(length, requestedLengths.length);
    });

    expect(requestedLengths).toEqual([64, 32]);
    expect(generated.verifier).toMatch(/^[A-Za-z0-9_-]{86}$/u);
    expect(generated.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(generated.challenge).toBe(pkceChallenge(generated.verifier));
    expect(generated.verifier).not.toContain("=");
    expect(generated.state).not.toContain("=");
  });
});
