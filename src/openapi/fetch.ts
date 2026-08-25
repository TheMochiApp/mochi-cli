import { lstat, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

import type { RuntimeConfig } from "../core/config.js";
import { CliError, ExitCode } from "../core/errors.js";
import { decodeOpenApiDocument } from "./validate.js";
import type { OpenApiDocument } from "./types.js";

const OPENAPI_TIMEOUT_MS = 15_000;
const MAX_OPENAPI_BYTES = 2 * 1024 * 1024;

class OpenApiTooLargeError extends Error {}

export async function fetchOpenApi(
  config: RuntimeConfig,
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<OpenApiDocument> {
  let response: Response;
  try {
    response = await fetchImplementation(config.openapiUrl, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(OPENAPI_TIMEOUT_MS),
    });
  } catch {
    throw new CliError("OPENAPI_FETCH_FAILED", "Could not fetch the OpenAPI document.", ExitCode.Network);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new CliError("OPENAPI_FETCH_FAILED", "Could not fetch the OpenAPI document.", ExitCode.Network);
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response.body);
  } catch (error) {
    if (error instanceof OpenApiTooLargeError) {
      throw new CliError("OPENAPI_TOO_LARGE", "The OpenAPI document exceeds the 2 MiB limit.", ExitCode.Local);
    }
    throw new CliError("OPENAPI_FETCH_FAILED", "Could not fetch the OpenAPI document.", ExitCode.Network);
  }

  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    throw new CliError("OPENAPI_INVALID", "The OpenAPI document is structurally invalid.", ExitCode.Local);
  }
  return decodeOpenApiDocument(value);
}

export async function writeOpenApi(document: OpenApiDocument, outputPath: string): Promise<void> {
  try {
    await writeOpenApiFile(document, outputPath);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("OPENAPI_WRITE_FAILED", "Could not write the OpenAPI document.", ExitCode.Local);
  }
}

async function writeOpenApiFile(document: OpenApiDocument, outputPath: string): Promise<void> {
  decodeOpenApiDocument(document);
  if (outputPath.length === 0 || basename(outputPath) === "." || basename(outputPath) === "..") throw unsafeOutput();

  const parent = dirname(outputPath);
  const parentStatus = await safeLstat(parent);
  if (!parentStatus?.isDirectory() || parentStatus.isSymbolicLink()) throw unsafeOutput();
  const initialTarget = await safeLstat(outputPath);
  if (initialTarget && (!initialTarget.isFile() || initialTarget.isSymbolicLink())) throw unsafeOutput();

  const temporaryPath = join(parent, `.${basename(outputPath)}.${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    const currentTarget = await safeLstat(outputPath);
    if (!sameTarget(initialTarget, currentTarget)) throw unsafeOutput();
    await rename(temporaryPath, outputPath);
    temporaryCreated = false;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("OPENAPI_WRITE_FAILED", "Could not write the OpenAPI document.", ExitCode.Local);
  } finally {
    if (temporaryCreated) await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_OPENAPI_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OpenApiTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function safeLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function sameTarget(
  initial: Awaited<ReturnType<typeof lstat>> | null,
  current: Awaited<ReturnType<typeof lstat>> | null,
): boolean {
  if (initial === null || current === null) return initial === current;
  return (
    initial.isFile() &&
    current.isFile() &&
    !current.isSymbolicLink() &&
    initial.dev === current.dev &&
    initial.ino === current.ino
  );
}

function unsafeOutput(): CliError {
  return new CliError("OPENAPI_OUTPUT_UNSAFE", "The OpenAPI output path is unsafe.", ExitCode.Local);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
