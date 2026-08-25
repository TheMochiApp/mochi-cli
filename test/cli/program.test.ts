import { describe, expect, test, vi } from "vitest";

import type { AuthStatus } from "../../src/auth/status.js";
import type { ResultJson } from "../../src/core/output.js";
import { runCli, type CliRuntimeDependencies } from "../../src/cli/program.js";
import type { LoginResult } from "../../src/oauth/login.js";
import type { LogoutResult } from "../../src/auth/logout.js";

interface Invocation {
  result: ResultJson<unknown>;
  exitCode: number;
  stderr: string;
}

function createDependencies(overrides: Partial<CliRuntimeDependencies> = {}): CliRuntimeDependencies {
  const authenticated: AuthStatus = {
    authenticated: true,
    scopes: [
      "analytics:read",
      "bookings:read",
      "config:read",
      "leads:read",
      "revenue:read",
      "signals:read",
      "team:read",
    ],
    resource: "https://api.themochi.app/v1/",
    accessExpiresAt: "2030-01-01T00:00:00.000Z",
    expired: false,
    storageBackend: "keyring",
  };

  return {
    login: vi.fn(async (): Promise<LoginResult> => ({
      authenticated: true,
      scopes: ["leads:read"],
      storageBackend: "keyring",
    })),
    status: vi.fn(async () => authenticated),
    logout: vi.fn(async (): Promise<LogoutResult> => ({
      authenticated: false,
      revoked: true,
      storageBackend: "keyring",
    })),
    fetchOpenApi: vi.fn(async () => ({ openapi: "3.0.3", info: { version: "1" }, paths: {} })),
    writeOpenApi: vi.fn(async () => undefined),
    validateOpenApi: vi.fn(() => ({ openapiVersion: "3.0.3", apiVersion: "1.0.0", operationCount: 18 })),
    apiGet: vi.fn(async (path: string) => ({ status: 200, body: { path } })),
    ...overrides,
  };
}

async function invoke(argv: string[], dependencies = createDependencies()): Promise<Invocation> {
  const writes: { result: ResultJson<unknown>; exitCode: number }[] = [];
  let stderr = "";
  await runCli(argv, dependencies, {
    writeResult(result, exitCode) {
      writes.push({ result, exitCode });
    },
    stderr(message) {
      stderr += `${message}\n`;
    },
  });
  expect(writes).toHaveLength(1);
  return { ...writes[0]!, stderr };
}

describe("CLI command composition", () => {
  test("returns machine-readable help without Commander text", async () => {
    const invocation = await invoke(["--help"]);

    expect(invocation.exitCode).toBe(0);
    expect(invocation.stderr).toBe("");
    expect(invocation.result).toEqual({
      ok: true,
      data: {
        commands: [
          "auth login",
          "auth status",
          "auth logout",
          "openapi fetch",
          "openapi validate",
          "leads list",
          "leads get",
          "leads intelligence",
          "signals list",
          "analytics",
          "bookings list",
          "revenue",
          "config",
          "connections list",
          "api get",
        ],
        docsUrl: "https://docs.themochi.app/",
      },
    });
  });

  test.each([
    [["unknown"], "unknown command"],
    [["auth", "status", "--unknown"], "unknown flag"],
    [["leads", "get"], "missing argument"],
    [["api", "get", "/v1/leads/", "extra"], "excess argument"],
  ])("turns %s into one bounded usage result", async (argv) => {
    const invocation = await invoke(argv);

    expect(invocation).toEqual({
      result: { ok: false, error: { code: "USAGE", message: "Invalid command. Run mochi --help." } },
      exitCode: 2,
      stderr: "",
    });
  });

  test("parses login scopes and explicit local-only logout", async () => {
    const dependencies = createDependencies();

    expect(
      (await invoke(["auth", "login", "--scopes", " signals:read,leads:read,signals:read "], dependencies)).exitCode,
    ).toBe(0);
    expect(dependencies.login).toHaveBeenCalledWith(["leads:read", "signals:read"], expect.any(Function));

    expect((await invoke(["auth", "status"], dependencies)).exitCode).toBe(0);
    expect(dependencies.status).toHaveBeenCalledOnce();

    expect((await invoke(["auth", "logout", "--local-only"], dependencies)).exitCode).toBe(0);
    expect(dependencies.logout).toHaveBeenCalledWith(true);
  });

  test("defaults and validates login scopes before invoking the dependency", async () => {
    const defaultDependencies = createDependencies();
    expect((await invoke(["auth", "login"], defaultDependencies)).exitCode).toBe(0);
    expect(defaultDependencies.login).toHaveBeenCalledWith(["leads:read"], expect.any(Function));

    for (const value of ["leads:write", "leads:read,", "leads:read,   "]) {
      const invalidDependencies = createDependencies();
      const invocation = await invoke(["auth", "login", "--scopes", value], invalidDependencies);
      expect(invocation.result).toEqual({
        ok: false,
        error: {
          code: "OAUTH_SCOPE_INVALID",
          message: "Only documented read-only Mochi scopes may be requested.",
        },
      });
      expect(invocation.exitCode).toBe(2);
      expect(invalidDependencies.login).not.toHaveBeenCalled();
    }
  });

  test("fetches and validates OpenAPI through the injected adapters", async () => {
    const dependencies = createDependencies();

    expect((await invoke(["openapi", "fetch", "--output", "./openapi.json"], dependencies)).result).toEqual({
      ok: true,
      data: { output: "./openapi.json" },
    });
    expect(dependencies.writeOpenApi).toHaveBeenCalledWith(expect.any(Object), "./openapi.json");

    expect((await invoke(["openapi", "validate"], dependencies)).result).toEqual({
      ok: true,
      data: { openapiVersion: "3.0.3", apiVersion: "1.0.0", operationCount: 18 },
    });
    expect(dependencies.validateOpenApi).toHaveBeenCalledWith(expect.any(Object));
  });

  test.each([
    [["leads", "list", "--query", "stage=NEW"], "/v1/leads/?stage=NEW"],
    [["leads", "get", "lead-123"], "/v1/leads/lead-123/"],
    [["leads", "intelligence", "lead-123"], "/v1/leads/lead-123/intelligence/"],
    [["signals", "list", "--query", "cursor=next_cursor_value"], "/v1/signals/?cursor=next_cursor_value"],
    [["analytics", "response-times"], "/v1/analytics/response-times/"],
    [["analytics", "reply-rate"], "/v1/analytics/reply-rate/"],
    [["analytics", "funnel"], "/v1/analytics/funnel/"],
    [["analytics", "messages"], "/v1/analytics/messages/"],
    [["analytics", "team"], "/v1/analytics/team/"],
    [["analytics", "links"], "/v1/analytics/links/"],
    [["analytics", "benchmarks"], "/v1/analytics/benchmarks/"],
    [["bookings", "list"], "/v1/bookings/"],
    [["revenue", "transactions"], "/v1/revenue/transactions/"],
    [["revenue", "summary"], "/v1/revenue/summary/"],
    [["revenue", "manual"], "/v1/revenue/manual/"],
    [["config", "funnels"], "/v1/config/funnels/"],
    [["config", "tags"], "/v1/config/tags/"],
    [["connections", "list"], "/v1/connections/"],
    [["api", "get", "/v1/send-policy/"], "/v1/send-policy/"],
  ])("maps %s to one authenticated GET", async (argv, expectedPath) => {
    const dependencies = createDependencies();
    const invocation = await invoke(argv, dependencies);

    expect(invocation.result).toEqual({ ok: true, data: { path: expectedPath } });
    expect(dependencies.apiGet).toHaveBeenCalledOnce();
    expect(dependencies.apiGet).toHaveBeenCalledWith(expectedPath);
  });

  test("preserves repeated queries deterministically and wraps the API body once", async () => {
    const dependencies = createDependencies({
      apiGet: vi.fn(async () => ({ status: 200, body: { ok: true, data: [1, 2] } })),
    });
    const invocation = await invoke(
      ["leads", "list", "--query", "stage=NEW", "--query", "stage=QUALIFIED", "--query", "search=hello world"],
      dependencies,
    );

    expect(dependencies.apiGet).toHaveBeenCalledWith("/v1/leads/?stage=NEW&stage=QUALIFIED&search=hello+world");
    expect(invocation.result).toEqual({ ok: true, data: { ok: true, data: [1, 2] } });
  });

  test("preserves repeated connection-list queries deterministically", async () => {
    const dependencies = createDependencies();

    const invocation = await invoke(
      ["connections", "list", "--query", "type=instagram", "--query", "status=active"],
      dependencies,
    );

    expect(dependencies.apiGet).toHaveBeenCalledWith("/v1/connections/?type=instagram&status=active");
    expect(invocation.result).toEqual({
      ok: true,
      data: { path: "/v1/connections/?type=instagram&status=active" },
    });
  });

  test("rejects missing operation scopes before API HTTP", async () => {
    const dependencies = createDependencies({
      status: vi.fn(async (): Promise<AuthStatus> => ({
        authenticated: true,
        scopes: ["leads:read"],
        resource: "https://api.themochi.app/v1/",
        accessExpiresAt: "2030-01-01T00:00:00.000Z",
        expired: false,
        storageBackend: "keyring",
      })),
    });

    const invocation = await invoke(["signals", "list"], dependencies);

    expect(invocation).toEqual({
      result: {
        ok: false,
        error: { code: "MISSING_SCOPE", message: "Run mochi auth login with the required read scopes." },
      },
      exitCode: 3,
      stderr: "",
    });
    expect(dependencies.apiGet).not.toHaveBeenCalled();
  });

  test("rejects unsafe raw targets before credential status or HTTP", async () => {
    const dependencies = createDependencies();

    const invocation = await invoke(["api", "get", "https://evil.example/v1/leads/"], dependencies);

    expect(invocation.exitCode).toBe(2);
    expect(dependencies.status).not.toHaveBeenCalled();
    expect(dependencies.apiGet).not.toHaveBeenCalled();
  });

  test("rejects a dangerous path placeholder before credential status or HTTP", async () => {
    const dependencies = createDependencies();

    const invocation = await invoke(["leads", "get", "../other-resource"], dependencies);

    expect(invocation.exitCode).toBe(2);
    expect(dependencies.status).not.toHaveBeenCalled();
    expect(dependencies.apiGet).not.toHaveBeenCalled();
  });

  test("maps API failure to bounded structured status and Retry-After without returning its body", async () => {
    const dependencies = createDependencies({
      apiGet: vi.fn(async () => ({ status: 429, body: { code: "secret-or-unbounded" }, retryAfter: "10" })),
    });

    const invocation = await invoke(["leads", "list"], dependencies);

    expect(invocation.result).toEqual({
      ok: false,
      error: {
        code: "API_RESPONSE",
        message: "The Mochi API returned an unsuccessful response.",
        details: { status: 429, retryAfter: "10" },
      },
    });
    expect(invocation.exitCode).toBe(6);
  });

  test.each(["REFRESH_TOKEN_CANARY_a91f", "x".repeat(300), "10 REFRESH_TOKEN_CANARY_a91f", "-1"])(
    "omits an unsafe Retry-After value from API failure output",
    async (retryAfter) => {
      const dependencies = createDependencies({
        apiGet: vi.fn(async () => ({ status: 429, body: {}, retryAfter })),
      });

      const invocation = await invoke(["leads", "list"], dependencies);
      const serialized = JSON.stringify(invocation);

      expect(invocation.result).toEqual({
        ok: false,
        error: {
          code: "API_RESPONSE",
          message: "The Mochi API returned an unsuccessful response.",
          details: { status: 429 },
        },
      });
      expect(serialized).not.toContain("REFRESH_TOKEN_CANARY_a91f");
    },
  );

  test.each(["--token", "--secret", "--verifier", "--authorization-code", "--bearer"])(
    "does not define a credential-bearing %s option",
    async (flag) => {
      const dependencies = createDependencies();
      const invocation = await invoke(["auth", "login", flag, "private-value"], dependencies);

      expect(invocation.exitCode).toBe(2);
      expect(JSON.stringify(invocation)).not.toContain("private-value");
      expect(dependencies.login).not.toHaveBeenCalled();
    },
  );
});
