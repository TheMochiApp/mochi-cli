import { CliError, ExitCode } from "../core/errors.js";
import type { OAuthHttp, OAuthHttpResponse } from "./types.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface OAuthHttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createOAuthHttp(options: OAuthHttpOptions = {}): OAuthHttp {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    getJson: (url) => requestJson(fetchImplementation, url, { method: "GET" }, timeoutMs),
    postJson: (url, body) =>
      requestJson(
        fetchImplementation,
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        timeoutMs,
      ),
    postForm: (url, body) =>
      requestJson(
        fetchImplementation,
        url,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        },
        timeoutMs,
      ),
  };
}

async function requestJson(
  fetchImplementation: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<OAuthHttpResponse> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new CliError("OAUTH_NETWORK_ERROR", "Could not reach the Mochi OAuth server.", ExitCode.Network);
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response.body);
  } catch {
    throw invalidResponse();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidResponse();
  }

  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw invalidResponse();
    }
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: response.status, body, headers };
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
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw invalidResponse();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function invalidResponse(): CliError {
  return new CliError("OAUTH_RESPONSE_INVALID", "The Mochi OAuth server returned an invalid response.", ExitCode.OAuth);
}
