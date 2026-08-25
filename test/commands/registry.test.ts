import { describe, expect, test } from "vitest";

import { CliError } from "../../src/core/errors.js";
import { buildReadOperationPath, READ_OPERATIONS } from "../../src/commands/registry.js";

describe("READ_OPERATIONS", () => {
  test("contains only the approved eighteen GET contracts", () => {
    expect(Object.keys(READ_OPERATIONS)).toEqual([
      "leads.list",
      "leads.get",
      "leads.intelligence",
      "signals.list",
      "bookings.list",
      "revenue.transactions",
      "revenue.summary",
      "revenue.manual",
      "config.funnels",
      "config.tags",
      "connections.list",
      "analytics.response-times",
      "analytics.reply-rate",
      "analytics.funnel",
      "analytics.messages",
      "analytics.team",
      "analytics.links",
      "analytics.benchmarks",
    ]);
    expect(READ_OPERATIONS["leads.intelligence"]).toEqual([
      "get_public_lead_intelligence",
      "/v1/leads/{lead_id}/intelligence/",
      ["leads:read", "signals:read"],
    ]);
    expect(Object.values(READ_OPERATIONS).every((operation) => operation[0].startsWith("get_"))).toBe(true);
  });
});

describe("buildReadOperationPath", () => {
  test("encodes only declared placeholders", () => {
    expect(buildReadOperationPath("leads.get", { lead_id: "lead/with spaces" })).toBe(
      "/v1/leads/lead%2Fwith%20spaces/",
    );
  });

  test.each([
    ["missing", {}],
    ["empty", { lead_id: "" }],
    ["extra", { lead_id: "lead-1", unexpected: "value" }],
  ])("rejects %s path values", (_case, values) => {
    expect(() => buildReadOperationPath("leads.get", values)).toThrow(CliError);
  });

  test("rejects values for operations without placeholders", () => {
    expect(() => buildReadOperationPath("leads.list", { lead_id: "lead-1" })).toThrow("path parameters");
  });
});
