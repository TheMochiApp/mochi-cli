import { CliError, ExitCode } from "../core/errors.js";
import { READ_OPERATIONS, type ReadOperationKey } from "../commands/registry.js";
import type { OpenApiDocument } from "./types.js";

export interface ReadOperationsValidation {
  operationCount: number;
}

export function validateReadOperations(value: unknown): ReadOperationsValidation {
  const document = decodeOpenApiDocument(value);
  for (const [operationKey, contract] of Object.entries(READ_OPERATIONS) as [
    ReadOperationKey,
    (typeof READ_OPERATIONS)[ReadOperationKey],
  ][]) {
    const [expectedOperationId, expectedPath, expectedScopes] = contract;
    const operation = document.paths[expectedPath]?.get;
    if (!operation) throw drift(operationKey, "GET operation is missing");
    if (operation.operationId !== expectedOperationId) throw drift(operationKey, "operation ID changed");
    if (!sameStrings(operation["x-mochi-required-scope"], expectedScopes)) {
      throw drift(operationKey, "required scopes changed");
    }
  }
  return { operationCount: Object.keys(READ_OPERATIONS).length };
}

export function decodeOpenApiDocument(value: unknown): OpenApiDocument {
  if (!isRecord(value) || !isNonBlankString(value.openapi)) throw invalidDocument();
  if (!isRecord(value.info) || !isNonBlankString(value.info.version)) {
    throw invalidDocument();
  }
  if (!isRecord(value.paths)) throw invalidDocument();
  return value as OpenApiDocument;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => typeof entry === "string" && entry === expected[index])
  );
}

function drift(operationKey: ReadOperationKey, reason: string): CliError {
  return new CliError("OPENAPI_DRIFT", `OpenAPI drift for ${operationKey}: ${reason}.`, ExitCode.Local);
}

function invalidDocument(): CliError {
  return new CliError("OPENAPI_INVALID", "The OpenAPI document is structurally invalid.", ExitCode.Local);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
