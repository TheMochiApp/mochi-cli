import { CliError, ExitCode } from "../core/errors.js";
import type { OAuthHttp, OAuthHttpResponse } from "../oauth/types.js";
import { withCredentialLock as acquireCredentialLock } from "../storage/lock.js";
import { resolveStoragePaths } from "../storage/paths.js";
import type { CredentialRepository } from "../storage/types.js";

export interface CredentialLock {
  <Result>(lockPath: string, callback: () => Promise<Result>): Promise<Result>;
}

export interface LogoutOptions {
  repository: CredentialRepository;
  http: OAuthHttp;
  localOnly?: boolean;
  lockPath?: string;
  withCredentialLock?: CredentialLock;
}

export interface LogoutResult {
  authenticated: false;
  revoked: boolean;
  storageBackend: CredentialRepository["backend"];
}

export async function logout(options: LogoutOptions): Promise<LogoutResult> {
  const withCredentialLock = options.withCredentialLock ?? acquireCredentialLock;
  const lockPath = options.lockPath ?? resolveStoragePaths().lockPath;

  return await withCredentialLock(lockPath, async () => {
    const credentials = await options.repository.getCredentials();
    if (!credentials) {
      return { authenticated: false, revoked: false, storageBackend: options.repository.backend };
    }

    if (!options.localOnly) {
      let response: OAuthHttpResponse;
      try {
        response = await options.http.postForm(
          credentials.revocationEndpoint,
          new URLSearchParams({ token: credentials.refreshToken, client_id: credentials.clientId }),
        );
      } catch {
        throw new CliError(
          "OAUTH_REVOCATION_FAILED",
          "Mochi could not confirm remote logout. Local credentials were kept; retry or use --local-only.",
          ExitCode.Network,
        );
      }
      if (response.status < 200 || response.status >= 300) {
        throw new CliError(
          "OAUTH_REVOCATION_FAILED",
          "Mochi could not confirm remote logout. Local credentials were kept; retry or use --local-only.",
          ExitCode.OAuth,
        );
      }
    }

    await options.repository.deleteCredentials();
    return {
      authenticated: false,
      revoked: !options.localOnly,
      storageBackend: options.repository.backend,
    };
  });
}
