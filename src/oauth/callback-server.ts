import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { CliError, ExitCode } from "../core/errors.js";
import { LOOPBACK_REDIRECT_URIS } from "./client-registration.js";
import type { OAuthCallback } from "./types.js";

const CALLBACK_TIMEOUT_MS = 300_000;
const SUCCESS_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Mochi</title></head>' +
  "<body><h1>Authorization complete</h1><p>You can close this window and return to the CLI.</p></body></html>";
const FAILURE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Mochi</title></head>' +
  "<body><h1>Authorization failed</h1><p>Return to the CLI for next steps.</p></body></html>";

export interface CallbackRequest {
  method?: string;
  host?: string;
  url?: string;
}

export type CallbackResponder = (status: number, html: string) => void;

export interface CallbackListenOptions {
  host: "127.0.0.1";
  port: number;
  onRequest: (request: CallbackRequest, respond: CallbackResponder) => Promise<void>;
}

export interface CallbackListener {
  close(): Promise<void>;
}

export type CallbackListen = (options: CallbackListenOptions) => Promise<CallbackListener>;

export interface WaitForOAuthCallbackOptions {
  redirectUris: readonly string[];
  expectedState: string;
  listen?: CallbackListen;
  onListening?: (redirectUri: string) => void | Promise<void>;
  timeoutMs?: number;
}

export async function waitForOAuthCallback({
  redirectUris,
  expectedState,
  listen = listenOnLoopback,
  onListening,
  timeoutMs = CALLBACK_TIMEOUT_MS,
}: WaitForOAuthCallbackOptions): Promise<OAuthCallback> {
  const callbacks = validateRedirectUris(redirectUris);
  if (callbacks.length === 0) {
    throw callbackInvalid();
  }

  let listener: CallbackListener | undefined;
  let redirectUri = "";
  let settled = false;
  let resolveResult: (callback: OAuthCallback) => void;
  let rejectResult: (error: CliError) => void;
  const result = new Promise<OAuthCallback>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const settle = async (outcome: OAuthCallback | CliError, status: number, respond?: CallbackResponder) => {
    if (settled) return;
    settled = true;
    respond?.(status, outcome instanceof CliError ? FAILURE_HTML : SUCCESS_HTML);
    await listener?.close().catch(() => undefined);
    if (outcome instanceof CliError) rejectResult(outcome);
    else resolveResult(outcome);
  };

  for (const callback of callbacks) {
    try {
      listener = await listen({
        host: "127.0.0.1",
        port: callback.port,
        onRequest: async (request, respond) => {
          if (settled) return;
          const parsed = validateCallbackRequest(request, callback.port, expectedState);
          if (parsed instanceof CliError) {
            await settle(parsed, 400, respond);
            return;
          }
          await settle({ code: parsed, redirectUri }, 200, respond);
        },
      });
      redirectUri = callback.url;
      break;
    } catch (error) {
      if (!isAddressInUse(error)) {
        throw new CliError(
          "OAUTH_CALLBACK_UNAVAILABLE",
          "The local OAuth callback could not be started.",
          ExitCode.OAuth,
        );
      }
    }
  }

  if (!listener) {
    throw new CliError(
      "OAUTH_CALLBACK_UNAVAILABLE",
      "All Mochi OAuth callback ports are in use. Close another login attempt and retry.",
      ExitCode.OAuth,
    );
  }

  const timer = setTimeout(() => {
    void settle(
      new CliError(
        "OAUTH_CALLBACK_TIMEOUT",
        "Browser authorization timed out. Run mochi auth login again.",
        ExitCode.OAuth,
      ),
      408,
    );
  }, timeoutMs);
  try {
    await onListening?.(redirectUri);
    return await result;
  } catch (error) {
    if (!settled) {
      const safeError =
        error instanceof CliError
          ? error
          : new CliError("OAUTH_BROWSER_FAILED", "Could not start browser authorization.", ExitCode.OAuth);
      settled = true;
      await listener.close().catch(() => undefined);
      throw safeError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function validateRedirectUris(redirectUris: readonly string[]): Array<{ url: string; port: number }> {
  if (
    redirectUris.length !== LOOPBACK_REDIRECT_URIS.length ||
    new Set(redirectUris).size !== LOOPBACK_REDIRECT_URIS.length ||
    !LOOPBACK_REDIRECT_URIS.every((uri) => redirectUris.includes(uri))
  ) {
    return [];
  }
  return LOOPBACK_REDIRECT_URIS.map((url) => ({ url, port: Number(new URL(url).port) }));
}

function validateCallbackRequest(request: CallbackRequest, port: number, expectedState: string): string | CliError {
  if (request.method !== "GET" || request.host !== `127.0.0.1:${port}` || !request.url) {
    return callbackInvalid();
  }
  let url: URL;
  try {
    url = new URL(request.url, `http://127.0.0.1:${port}`);
  } catch {
    return callbackInvalid();
  }
  if (url.origin !== `http://127.0.0.1:${port}` || url.pathname !== "/callback") {
    return callbackInvalid();
  }

  const states = url.searchParams.getAll("state");
  const codes = url.searchParams.getAll("code");
  const errors = url.searchParams.getAll("error");
  if (states.length !== 1 || !constantTimeEqual(states[0] ?? "", expectedState)) {
    return new CliError("OAUTH_STATE_MISMATCH", "The OAuth callback state was invalid.", ExitCode.OAuth);
  }
  if (errors.length === 1 && codes.length === 0) {
    return new CliError("OAUTH_AUTHORIZATION_DENIED", "Mochi authorization was not granted.", ExitCode.OAuth);
  }
  if (errors.length !== 0 || codes.length !== 1 || !codes[0]?.trim()) {
    return callbackInvalid();
  }
  return codes[0];
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function callbackInvalid(): CliError {
  return new CliError("OAUTH_CALLBACK_INVALID", "The OAuth callback request was invalid.", ExitCode.OAuth);
}

function isAddressInUse(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
}

export async function listenOnLoopback(options: CallbackListenOptions): Promise<CallbackListener> {
  return await new Promise<CallbackListener>((resolve, reject) => {
    const server = createServer((request, response) => {
      void options.onRequest(
        { method: request.method, host: request.headers.host, url: request.url },
        (status, html) => {
          response.writeHead(status, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
            "x-content-type-options": "nosniff",
          });
          response.end(html);
        },
      );
    });
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve({
        close: () =>
          new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          }),
      });
    });
  });
}
