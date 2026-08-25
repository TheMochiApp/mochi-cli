import { CliError, ExitCode } from "../core/errors.js";
import type { RuntimeConfig } from "../core/config.js";
import { createFileStore } from "./file-store.js";
import { loadNativeKeyringStore } from "./keyring-store.js";
import { resolveStoragePaths } from "./paths.js";
import {
  decodeCredentialBundle,
  decodePublicClientRecord,
  type CredentialBundle,
  type CredentialRepository,
  type PublicClientRecord,
  type SecretStore,
} from "./types.js";

export interface CredentialRepositoryOptions {
  runtimeConfig?: RuntimeConfig;
  keyringLoader?: () => Promise<SecretStore>;
  fileStore?: SecretStore;
  clientStore?: SecretStore;
}

export async function createCredentialRepository(
  options: CredentialRepositoryOptions = {},
): Promise<CredentialRepository> {
  const paths = resolveStoragePaths();
  const fileStore = options.fileStore ?? createFileStore(paths.credentialsPath);
  const clientStore = options.clientStore ?? createFileStore(paths.clientPath);
  const keyringLoader = options.keyringLoader ?? loadNativeKeyringStore;
  let credentialStore: SecretStore;
  let backend: CredentialRepository["backend"];

  try {
    credentialStore = await keyringLoader();
    await credentialStore.get();
    backend = "keyring";
  } catch {
    credentialStore = fileStore;
    backend = "file-0600";
  }

  return {
    backend,
    async getCredentials(): Promise<CredentialBundle | null> {
      const bundle = decodeStoredValue(await credentialStore.get(), decodeCredentialBundle);
      return validateConfiguredApiBase(bundle, options.runtimeConfig);
    },
    async setCredentials(bundle: CredentialBundle): Promise<void> {
      const validated = validateConfiguredApiBase(decodeCredentialBundle(bundle), options.runtimeConfig);
      if (!validated) {
        throw invalidCredential();
      }
      await credentialStore.set(JSON.stringify(validated));
    },
    async deleteCredentials(): Promise<void> {
      await credentialStore.delete();
    },
    async getClientRecord(): Promise<PublicClientRecord | null> {
      return decodeStoredValue(await clientStore.get(), decodePublicClientRecord);
    },
    async setClientRecord(record: PublicClientRecord): Promise<void> {
      const validated = decodePublicClientRecord(record);
      if (!validated) {
        throw invalidCredential();
      }
      await clientStore.set(JSON.stringify(validated));
    },
    async deleteClientRecord(): Promise<void> {
      await clientStore.delete();
    },
  };
}

function validateConfiguredApiBase(
  bundle: CredentialBundle | null,
  runtimeConfig: RuntimeConfig | undefined,
): CredentialBundle | null {
  if (bundle && runtimeConfig && bundle.apiBaseUrl !== runtimeConfig.apiBaseUrl) {
    throw invalidCredential();
  }
  return bundle;
}

function decodeStoredValue<Value>(serialized: string | null, decode: (value: unknown) => Value | null): Value | null {
  if (serialized === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw invalidCredential();
  }

  const value = decode(parsed);
  if (!value) {
    throw invalidCredential();
  }
  return value;
}

function invalidCredential(): CliError {
  return new CliError(
    "CREDENTIAL_INVALID",
    "Stored Mochi credentials are invalid. Run mochi auth login again after removing them.",
    ExitCode.Local,
  );
}
