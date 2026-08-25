import type { SecretStore } from "./types.js";

const KEYRING_SERVICE = "app.themochi.cli";
const KEYRING_ACCOUNT = "default";

interface NativeEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deleteCredential(): boolean;
}

interface NativeKeyringModule {
  Entry: new (service: string, account: string) => NativeEntry;
}

export async function loadNativeKeyringStore(): Promise<SecretStore> {
  const keyring = (await import("@napi-rs/keyring")) as NativeKeyringModule;
  const entry = new keyring.Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);

  return {
    async get(): Promise<string | null> {
      return entry.getPassword();
    },
    async set(value: string): Promise<void> {
      entry.setPassword(value);
    },
    async delete(): Promise<void> {
      entry.deleteCredential();
    },
  };
}
