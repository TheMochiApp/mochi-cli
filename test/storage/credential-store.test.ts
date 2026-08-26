import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { CliError } from "../../src/core/errors.js";
import type { RuntimeConfig } from "../../src/core/config.js";
import { createCredentialRepository } from "../../src/storage/credential-store.js";
import { createFileStore } from "../../src/storage/file-store.js";
import type { CredentialBundle, SecretStore } from "../../src/storage/types.js";

const temporaryDirectories: string[] = [];

const VALID_BUNDLE: CredentialBundle = {
  accessToken: "access-secret",
  refreshToken: "refresh-secret",
  accessExpiresAt: "2026-08-25T15:00:00.000Z",
  scopes: ["leads:read"],
  resource: "https://api.themochi.app/v1/",
  clientId: "client-id",
  tokenEndpoint: "https://api.themochi.app/api/zapier/oauth/token/",
  revocationEndpoint: "https://api.themochi.app/api/zapier/oauth/revoke/",
  apiBaseUrl: "https://api.themochi.app",
};

const RUNTIME_CONFIG: RuntimeConfig = {
  apiBaseUrl: "https://api.themochi.app",
  issuerUrl: "https://api.themochi.app",
  openapiUrl: "https://openapi.gitbook.com/o/bpgVa93BfrzaqXzuggv8/spec/mochi-api.json",
};

async function createFallbackStore(): Promise<SecretStore> {
  const directory = await mkdtemp(join(tmpdir(), "mochi-repository-"));
  temporaryDirectories.push(directory);
  return createFileStore(join(directory, "mochi", "credentials.json"));
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("credential repository", () => {
  test("rejects an unsafe runtime origin pairing before probing stored credentials", async () => {
    const keyringLoader = vi.fn(async (): Promise<SecretStore> => {
      throw new Error("must not load");
    });

    await expect(
      createCredentialRepository({
        runtimeConfig: {
          ...RUNTIME_CONFIG,
          apiBaseUrl: "https://attacker.example",
          issuerUrl: "https://api.themochi.app",
        },
        keyringLoader,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(keyringLoader).not.toHaveBeenCalled();
  });

  test("falls back explicitly when the lazy native keyring loader is unavailable", async () => {
    const fileStore = await createFallbackStore();

    const repository = await createCredentialRepository({
      platform: "linux",
      keyringLoader: async () => {
        throw new Error("native binding unavailable");
      },
      fileStore,
    });

    expect(repository.backend).toBe("file-0600");
  });

  test("uses an available keyring without touching the fallback", async () => {
    const keyring: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const fileStore: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };

    const repository = await createCredentialRepository({
      keyringLoader: async () => keyring,
      fileStore,
    });
    await repository.setCredentials(VALID_BUNDLE);

    expect(repository.backend).toBe("keyring");
    expect(keyring.set).toHaveBeenCalledOnce();
    expect(fileStore.set).not.toHaveBeenCalled();
  });

  test("round-trips and validates every credential field", async () => {
    const fileStore = await createFallbackStore();
    const repository = await createCredentialRepository({
      platform: "linux",
      keyringLoader: async () => {
        throw new Error("unavailable");
      },
      fileStore,
    });

    await repository.setCredentials(VALID_BUNDLE);

    await expect(repository.getCredentials()).resolves.toEqual(VALID_BUNDLE);
  });

  test.each([
    ["a different OAuth resource", { ...VALID_BUNDLE, resource: "https://evil.example/v1/" }],
    ["an insecure token endpoint", { ...VALID_BUNDLE, tokenEndpoint: "http://api.themochi.app/token" }],
    ["a malformed absolute expiry", { ...VALID_BUNDLE, accessExpiresAt: "tomorrow" }],
    ["an empty refresh token", { ...VALID_BUNDLE, refreshToken: "" }],
    ["an invalid scope list", { ...VALID_BUNDLE, scopes: [""] }],
  ])("rejects %s in stored JSON without replacing it", async (_name, malformedBundle) => {
    const fileStore = await createFallbackStore();
    await fileStore.set(JSON.stringify(malformedBundle));
    const repository = await createCredentialRepository({
      platform: "linux",
      keyringLoader: async () => {
        throw new Error("unavailable");
      },
      fileStore,
    });

    const failure = await repository.getCredentials().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CliError);
    expect((failure as CliError).code).toBe("CREDENTIAL_INVALID");
    expect(await fileStore.get()).toBe(JSON.stringify(malformedBundle));
  });

  test("rejects unknown credential fields instead of silently accepting schema drift", async () => {
    const fileStore = await createFallbackStore();
    const stored = JSON.stringify({ ...VALID_BUNDLE, unexpectedSecret: "must-not-be-accepted" });
    await fileStore.set(stored);
    const repository = await createCredentialRepository({
      platform: "linux",
      keyringLoader: async () => {
        throw new Error("unavailable");
      },
      fileStore,
    });

    await expect(repository.getCredentials()).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
    expect(await fileStore.get()).toBe(stored);
  });

  test("rejects credentials bound to a different configured API base", async () => {
    const fileStore = await createFallbackStore();
    await fileStore.set(JSON.stringify({ ...VALID_BUNDLE, apiBaseUrl: "https://staging.themochi.app" }));
    const repository = await createCredentialRepository({
      platform: "linux",
      runtimeConfig: RUNTIME_CONFIG,
      keyringLoader: async () => {
        throw new Error("unavailable");
      },
      fileStore,
    });

    await expect(repository.getCredentials()).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
  });

  test("fails closed on Windows when the native keyring is unavailable", async () => {
    const fileStore: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };

    await expect(
      createCredentialRepository({
        platform: "win32",
        keyringLoader: async () => {
          throw new Error("native binding unavailable");
        },
        fileStore,
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STORAGE_UNAVAILABLE" });
    expect(fileStore.get).not.toHaveBeenCalled();
  });
});
