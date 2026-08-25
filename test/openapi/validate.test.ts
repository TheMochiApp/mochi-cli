import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { CliError } from "../../src/core/errors.js";
import { validateReadOperations } from "../../src/openapi/validate.js";

const FIXTURE_URL = new URL("../fixtures/public-api-openapi.json", import.meta.url);

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(FIXTURE_URL, "utf8")) as Record<string, unknown>;
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function paths(document: Record<string, unknown>): Record<string, Record<string, Record<string, unknown>>> {
  return document.paths as Record<string, Record<string, Record<string, unknown>>>;
}

function expectDrift(document: Record<string, unknown>, operationKey: string): void {
  try {
    validateReadOperations(document);
    throw new Error("expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    const cliError = error as CliError;
    expect(cliError.code).toBe("OPENAPI_DRIFT");
    expect(cliError.message).toContain(operationKey);
    expect(cliError.message).not.toContain(JSON.stringify(document));
    expect(cliError.details).toBeUndefined();
  }
}

describe("validateReadOperations", () => {
  test("accepts the canonical bounded read contract", async () => {
    expect(validateReadOperations(await fixture())).toEqual({ operationCount: 18 });
  });

  test("rejects operation ID drift without dumping the document", async () => {
    const document = clone(await fixture());
    paths(document)["/v1/leads/"]!.get!.operationId = "changed";
    expectDrift(document, "leads.list");
  });

  test("rejects method drift", async () => {
    const document = clone(await fixture());
    const path = paths(document)["/v1/signals/"]!;
    path.post = path.get!;
    delete path.get;
    expectDrift(document, "signals.list");
  });

  test("rejects path drift", async () => {
    const document = clone(await fixture());
    const documentPaths = paths(document);
    documentPaths["/v1/leads-v2/"] = documentPaths["/v1/leads/"]!;
    delete documentPaths["/v1/leads/"];
    expectDrift(document, "leads.list");
  });

  test("rejects exact required-scope drift", async () => {
    const document = clone(await fixture());
    paths(document)["/v1/leads/{lead_id}/intelligence/"]!.get!["x-mochi-required-scope"] = ["leads:read"];
    expectDrift(document, "leads.intelligence");
  });
});
