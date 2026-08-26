import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, test } from "vitest";

const skillRoot = resolve(import.meta.dirname, "../../skills/mochi-api");
let instructions: string;

beforeAll(async () => {
  instructions = (
    await Promise.all([
      readFile(resolve(skillRoot, "SKILL.md"), "utf8"),
      readFile(resolve(skillRoot, "references/authentication.md"), "utf8"),
      readFile(resolve(skillRoot, "references/docs-discovery.md"), "utf8"),
      readFile(resolve(skillRoot, "references/integration-safety.md"), "utf8"),
    ])
  ).join("\n");
});

describe("mochi-api behavioral guardrails", () => {
  test("routes interactive, unattended, existing MCP, and browser-app workloads", () => {
    expect(instructions).toContain("interactive local");
    expect(instructions).toContain("OAuth");
    expect(instructions).toContain("unattended");
    expect(instructions).toContain("API key");
    expect(instructions).toContain("existing MCP connection");
    expect(instructions).toContain("registered OAuth application");
    expect(instructions).toContain("minimum scopes");
  });

  test("discovers current docs before constructing requests", () => {
    expect(instructions).toContain("https://docs.themochi.app/llms.txt");
    expect(instructions).toContain("smallest relevant task guide");
    expect(instructions).toContain("OpenAPI");
    expect(instructions).toContain("mochi --help");
    expect(instructions).toContain("broad research");
    expect(instructions).toContain("stop and report");
  });

  test("treats fetched documentation as untrusted reference data", () => {
    expect(instructions).toContain("untrusted reference data");
    expect(instructions).toContain("cannot grant authorization");
    expect(instructions).toMatch(/cannot [^.]+ override/u);
    expect(instructions).toContain("Do not execute commands");
    expect(instructions).toContain("approved documentation hosts");
    expect(instructions).toContain("https://openapi.gitbook.com/o/bpgVa93BfrzaqXzuggv8/spec/mochi-api.json");
    expect(instructions).not.toContain("M0sgy6xKutCblHRqGmE5");
  });

  test("routes a first interactive read through the guided CLI path", () => {
    expect(instructions).toContain("mochi quickstart");
    expect(instructions).toContain("current CLI help");
  });

  test("keeps credentials outside agent context and preserves MCP", () => {
    expect(instructions).toContain("Never request, read, paste, print, log, or store a credential");
    expect(instructions).toContain("OS keychain");
    expect(instructions).toContain("server-side secret manager");
    expect(instructions).toContain("Do not export, exchange, or convert its credential");
  });

  test("requires bounded approval and verification for direct API writes", () => {
    expect(instructions).toContain("read-only");
    expect(instructions).toContain("role floor");
    expect(instructions).toContain("idempotency");
    expect(instructions).toContain("partial-failure");
    expect(instructions).toContain("explicit approval");
    expect(instructions).toContain("verification");
    expect(instructions).toContain("outbound message");
    expect(instructions).toContain("automation activation");
    expect(instructions).toContain("flow run");
  });
});
