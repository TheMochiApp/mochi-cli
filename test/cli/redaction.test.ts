import { describe, expect, test, vi } from "vitest";

import type { ResultJson } from "../../src/core/output.js";
import { runCli, type CliRuntimeDependencies } from "../../src/cli/program.js";
import type { AuthStatus } from "../../src/auth/status.js";
import type { LoginResult } from "../../src/oauth/login.js";
import type { LogoutResult } from "../../src/auth/logout.js";

const canaries = {
  accessToken: "ACCESS_TOKEN_CANARY_8ed2",
  refreshToken: "REFRESH_TOKEN_CANARY_a91f",
  authorizationCode: "AUTH_CODE_CANARY_d472",
  verifier: "PKCE_VERIFIER_CANARY_3fce",
} as const;

function failingDependencies(kind: "login" | "refresh" | "api" | "logout"): CliRuntimeDependencies {
  const circular: Record<string, unknown> = { nested: new Error(Object.values(canaries).join("|")) };
  circular.self = circular;
  const fail = (): never => {
    throw circular;
  };

  return {
    login: vi.fn(async (_scopes, stderr): Promise<LoginResult> => {
      stderr(
        "Open this URL to authorize Mochi:\nhttps://app.themochi.app/oauth?state=safe-state&code_challenge=safe-challenge",
      );
      if (kind === "login") fail();
      return { authenticated: true, scopes: ["leads:read"], storageBackend: "keyring" };
    }),
    status: vi.fn(async (): Promise<AuthStatus> => ({
      authenticated: true,
      scopes: ["leads:read"],
      resource: "https://api.themochi.app/v1/",
      accessExpiresAt: "2030-01-01T00:00:00.000Z",
      expired: false,
      storageBackend: "keyring",
    })),
    logout: vi.fn(async (): Promise<LogoutResult> => {
      if (kind === "logout") fail();
      return { authenticated: false, revoked: true, storageBackend: "keyring" };
    }),
    fetchOpenApi: vi.fn(async () => ({ openapi: "3.0.3", info: { version: "1" }, paths: {} })),
    writeOpenApi: vi.fn(async () => undefined),
    validateOpenApi: vi.fn(() => ({ operationCount: 18 })),
    apiGet: vi.fn(async () => {
      if (kind === "refresh") fail();
      if (kind === "api") {
        return {
          status: 500,
          retryAfter: Object.values(canaries).join("|"),
          body: {
            accessToken: canaries.accessToken,
            refreshToken: canaries.refreshToken,
            authorizationCode: canaries.authorizationCode,
            verifier: canaries.verifier,
            nested: new Error(canaries.accessToken),
            circular,
          },
        };
      }
      return { status: 200, body: {} };
    }),
  };
}

async function capture(argv: string[], dependencies: CliRuntimeDependencies): Promise<string> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  await runCli(argv, dependencies, {
    writeResult(result: ResultJson<unknown>, exitCode: number) {
      stdout.push(`${JSON.stringify(result)}\n${exitCode}`);
    },
    stderr(message) {
      stderr.push(message);
    },
  });
  return [...stdout, ...stderr].join("\n");
}

describe("CLI redaction boundary", () => {
  test("never emits credentials, codes, verifiers, nested Errors, circular values, or Commander text", async () => {
    const outputs = await Promise.all([
      capture(["auth", "login"], failingDependencies("login")),
      capture(["leads", "list"], failingDependencies("refresh")),
      capture(["leads", "list"], failingDependencies("api")),
      capture(["auth", "logout"], failingDependencies("logout")),
      capture(["not-a-command", ...Object.values(canaries)], failingDependencies("api")),
    ]);
    const combined = outputs.join("\n");

    for (const canary of Object.values(canaries)) expect(combined).not.toContain(canary);
    expect(combined).not.toContain("CommanderError");
    expect(combined).not.toContain("Usage:");
    expect(combined).not.toContain("[object Object]");
    expect(combined).not.toContain("stack");
  });

  test("allows a manual authorization URL with state and challenge only on stderr", async () => {
    const output = await capture(["auth", "login"], failingDependencies("login"));

    expect(output).toContain("state=safe-state");
    expect(output).toContain("code_challenge=safe-challenge");
    for (const canary of Object.values(canaries)) expect(output).not.toContain(canary);
  });
});
