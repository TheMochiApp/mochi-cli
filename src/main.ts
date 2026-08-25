import { AuthenticatedClient } from "./api/authenticated-client.js";
import { logout } from "./auth/logout.js";
import { authStatus } from "./auth/status.js";
import { runCli as runProgram, type CliRuntimeDependencies } from "./cli/program.js";
import { loadRuntimeConfig, type RuntimeConfig } from "./core/config.js";
import { createOAuthHttp } from "./oauth/http.js";
import { login } from "./oauth/login.js";
import type { OAuthHttp } from "./oauth/types.js";
import { fetchOpenApi, writeOpenApi } from "./openapi/fetch.js";
import { validateReadOperations } from "./openapi/validate.js";
import { createCredentialRepository } from "./storage/credential-store.js";
import type { CredentialRepository } from "./storage/types.js";

interface AuthContext {
  config: RuntimeConfig;
  repository: CredentialRepository;
  http: OAuthHttp;
  client: AuthenticatedClient;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  let runtimeConfig: RuntimeConfig | undefined;
  let authContext: Promise<AuthContext> | undefined;

  const getConfig = (): RuntimeConfig => {
    runtimeConfig ??= loadRuntimeConfig();
    return runtimeConfig;
  };
  const getAuthContext = (): Promise<AuthContext> => {
    authContext ??= createAuthContext(getConfig());
    return authContext;
  };

  const dependencies: CliRuntimeDependencies = {
    async login(scopes, stderr) {
      const context = await getAuthContext();
      return await login({
        config: context.config,
        repository: context.repository,
        http: context.http,
        readonlyScopes: scopes,
        stderr,
      });
    },
    async status() {
      const context = await getAuthContext();
      return await authStatus({ repository: context.repository });
    },
    async logout(localOnly) {
      const context = await getAuthContext();
      return await logout({ repository: context.repository, http: context.http, localOnly });
    },
    async fetchOpenApi() {
      return await fetchOpenApi(getConfig());
    },
    async writeOpenApi(document, outputPath) {
      await writeOpenApi(document, outputPath);
    },
    validateOpenApi: validateReadOperations,
    async apiGet(target) {
      return await (await getAuthContext()).client.get(target);
    },
  };

  await runProgram(argv, dependencies);
}

async function createAuthContext(config: RuntimeConfig): Promise<AuthContext> {
  const repository = await createCredentialRepository({ runtimeConfig: config });
  const http = createOAuthHttp();
  return {
    config,
    repository,
    http,
    client: new AuthenticatedClient({ config, repository, http }),
  };
}
