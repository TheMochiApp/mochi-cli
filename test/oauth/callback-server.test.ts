import { describe, expect, test, vi } from "vitest";

import { LOOPBACK_REDIRECT_URIS } from "../../src/oauth/client-registration.js";
import {
  waitForOAuthCallback,
  type CallbackListenOptions,
  type CallbackListener,
} from "../../src/oauth/callback-server.js";
import { openBrowser } from "../../src/oauth/browser.js";

interface Harness {
  listen: (options: CallbackListenOptions) => Promise<CallbackListener>;
  attempts: Array<{ host: string; port: number }>;
  current?: CallbackListenOptions;
  close: ReturnType<typeof vi.fn>;
}

function harness(busyPorts: number[] = []): Harness {
  const attempts: Array<{ host: string; port: number }> = [];
  const close = vi.fn(async () => undefined);
  const value: Harness = {
    attempts,
    close,
    listen: async (options) => {
      attempts.push({ host: options.host, port: options.port });
      if (busyPorts.includes(options.port)) {
        throw Object.assign(new Error("busy"), { code: "EADDRINUSE" });
      }
      value.current = options;
      return { close };
    },
  };
  return value;
}

async function settleRequest(
  callbackPromise: Promise<unknown>,
  value: Harness,
  overrides: Partial<{ method: string; host: string; url: string }> = {},
) {
  await vi.waitFor(() => expect(value.current).toBeDefined());
  const respond = vi.fn();
  await value.current?.onRequest(
    {
      method: overrides.method ?? "GET",
      host: overrides.host ?? "127.0.0.1:48151",
      url: overrides.url ?? "/callback?code=authorization-code&state=expected-state",
    },
    respond,
  );
  return { result: await callbackPromise.catch((error: unknown) => error), respond };
}

describe("OAuth loopback callback", () => {
  test("binds only to loopback and selects the first free registered port", async () => {
    const listener = harness([48151, 48152]);
    const onListening = vi.fn();
    const callbackPromise = waitForOAuthCallback({
      redirectUris: LOOPBACK_REDIRECT_URIS,
      expectedState: "expected-state",
      listen: listener.listen,
      onListening,
    });
    await vi.waitFor(() => expect(listener.current?.port).toBe(48153));
    expect(listener.attempts).toEqual([
      { host: "127.0.0.1", port: 48151 },
      { host: "127.0.0.1", port: 48152 },
      { host: "127.0.0.1", port: 48153 },
    ]);
    expect(onListening).toHaveBeenCalledWith("http://127.0.0.1:48153/callback");

    const { result } = await settleRequest(callbackPromise, listener, {
      host: "127.0.0.1:48153",
    });
    expect(result).toEqual({ code: "authorization-code", redirectUri: "http://127.0.0.1:48153/callback" });
  });

  test.each([
    ["state mismatch", { url: "/callback?code=authorization-code&state=wrong-state" }, "OAUTH_STATE_MISMATCH"],
    ["OAuth error", { url: "/callback?error=access_denied&state=expected-state" }, "OAUTH_AUTHORIZATION_DENIED"],
    ["wrong method", { method: "POST" }, "OAUTH_CALLBACK_INVALID"],
    ["wrong path", { url: "/other?code=authorization-code&state=expected-state" }, "OAUTH_CALLBACK_INVALID"],
    ["wrong host", { host: "localhost:48151" }, "OAUTH_CALLBACK_INVALID"],
    [
      "duplicate code",
      {
        url: "/callback?code=first&code=second&state=expected-state",
      },
      "OAUTH_CALLBACK_INVALID",
    ],
  ])("rejects %s and closes after the first request", async (_name, request, code) => {
    const listener = harness();
    const callbackPromise = waitForOAuthCallback({
      redirectUris: LOOPBACK_REDIRECT_URIS,
      expectedState: "expected-state",
      listen: listener.listen,
    });

    const { result } = await settleRequest(callbackPromise, listener, request);

    expect(result).toMatchObject({ code });
    expect(listener.close).toHaveBeenCalledOnce();
  });

  test("times out after five minutes and closes the listener", async () => {
    vi.useFakeTimers();
    try {
      const listener = harness();
      const callbackPromise = waitForOAuthCallback({
        redirectUris: LOOPBACK_REDIRECT_URIS,
        expectedState: "expected-state",
        listen: listener.listen,
      });
      const rejection = expect(callbackPromise).rejects.toMatchObject({ code: "OAUTH_CALLBACK_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(300_000);

      await rejection;
      expect(listener.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test("returns constant HTML that contains neither authorization code nor state", async () => {
    const listener = harness();
    const callbackPromise = waitForOAuthCallback({
      redirectUris: LOOPBACK_REDIRECT_URIS,
      expectedState: "sensitive-state",
      listen: listener.listen,
    });

    const { respond } = await settleRequest(callbackPromise, listener, {
      url: "/callback?code=sensitive-code&state=sensitive-state",
    });
    const body = respond.mock.calls[0]?.[1] as string;
    expect(body).toContain("Authorization complete");
    expect(body).not.toContain("sensitive-code");
    expect(body).not.toContain("sensitive-state");
  });

  test("fails when all five registered ports are occupied", async () => {
    const listener = harness([48151, 48152, 48153, 48154, 48155]);

    await expect(
      waitForOAuthCallback({
        redirectUris: LOOPBACK_REDIRECT_URIS,
        expectedState: "expected-state",
        listen: listener.listen,
      }),
    ).rejects.toMatchObject({ code: "OAUTH_CALLBACK_UNAVAILABLE" });
  });

  test("closes and sanitizes an injected browser-start failure", async () => {
    const listener = harness();

    const failure = await waitForOAuthCallback({
      redirectUris: LOOPBACK_REDIRECT_URIS,
      expectedState: "expected-state",
      listen: listener.listen,
      onListening: () => {
        throw new Error("pkce-verifier-secret");
      },
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "OAUTH_BROWSER_FAILED" });
    expect(String(failure)).not.toContain("pkce-verifier-secret");
    expect(listener.close).toHaveBeenCalledOnce();
  });
});

describe("browser adapter", () => {
  test.each([
    ["darwin" as const, "open", ["https://app.themochi.app/authorize"]],
    ["linux" as const, "xdg-open", ["https://app.themochi.app/authorize"]],
    ["win32" as const, "rundll32", ["url.dll,FileProtocolHandler", "https://app.themochi.app/authorize"]],
  ])("uses argument-array invocation on %s", async (platform, command, args) => {
    const child = {
      once: vi.fn((event: string, callback: (value: Error | number | null) => void) => {
        if (event === "close") callback(0);
        return child;
      }),
    };
    const spawn = vi.fn(() => child);

    await expect(openBrowser("https://app.themochi.app/authorize", { platform, spawn })).resolves.toBeNull();
    expect(spawn).toHaveBeenCalledWith(command, args, { stdio: "ignore", windowsHide: true });
  });

  test("returns the authorization URL when opening fails", async () => {
    const authorizationUrl = "https://app.themochi.app/authorize?state=safe";
    const child = {
      once: vi.fn((event: string, callback: (value: Error | number | null) => void) => {
        if (event === "close") callback(1);
        return child;
      }),
    };
    const spawn = vi.fn(() => child);

    await expect(openBrowser(authorizationUrl, { platform: "linux", spawn })).resolves.toBe(authorizationUrl);
  });
});
