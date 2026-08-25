import type { CredentialRepository } from "../storage/types.js";

export interface AuthStatusOptions {
  repository: CredentialRepository;
  now?: () => Date;
}

export type AuthStatus =
  | { authenticated: false; storageBackend: CredentialRepository["backend"] }
  | {
      authenticated: true;
      scopes: string[];
      resource: string;
      accessExpiresAt: string;
      expired: boolean;
      storageBackend: CredentialRepository["backend"];
    };

export async function authStatus(options: AuthStatusOptions): Promise<AuthStatus> {
  const credentials = await options.repository.getCredentials();
  if (!credentials) {
    return { authenticated: false, storageBackend: options.repository.backend };
  }
  const now = options.now?.() ?? new Date();
  return {
    authenticated: true,
    scopes: [...credentials.scopes],
    resource: credentials.resource,
    accessExpiresAt: credentials.accessExpiresAt,
    expired: Date.parse(credentials.accessExpiresAt) <= now.getTime(),
    storageBackend: options.repository.backend,
  };
}
