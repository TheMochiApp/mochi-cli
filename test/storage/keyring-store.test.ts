import { describe, expect, test, vi } from "vitest";

import { createNativeKeyringStore } from "../../src/storage/keyring-store.js";

describe("native keyring store", () => {
  test("treats a false native delete result as a sanitized storage failure", async () => {
    const entry = {
      getPassword: vi.fn(() => "credential-secret"),
      setPassword: vi.fn(),
      deleteCredential: vi.fn(() => false),
    };
    const store = createNativeKeyringStore(entry);

    const failure = await store.delete().catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "CREDENTIAL_STORAGE_FAILED",
      message: "Secure credential storage failed.",
    });
    expect(JSON.stringify(failure)).not.toContain("credential-secret");
    expect(entry.deleteCredential).toHaveBeenCalledOnce();
  });
});
