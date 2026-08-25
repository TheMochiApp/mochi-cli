import type { Command } from "commander";

import type { ApiResponse } from "../../api/types.js";
import type { AuthStatus } from "../../auth/status.js";
import { buildReadOperationPath, READ_OPERATIONS } from "../../commands/registry.js";
import { CliError, ExitCode } from "../../core/errors.js";
import { PUBLIC_API_RESOURCE } from "../../storage/types.js";
import type { CliRuntimeDependencies, ProgramExecution } from "../program.js";

const DOCS_INDEX_URL = "https://docs.themochi.app/llms.txt";
const FIRST_READ_OPERATION = "leads.list";
type AuthenticatedStatus = Extract<AuthStatus, { authenticated: true }>;

export function addQuickstartCommand(
  program: Command,
  dependencies: CliRuntimeDependencies,
  execution: ProgramExecution,
): void {
  program
    .command("quickstart")
    .description("Validate, authorize if needed, and verify one read without returning customer data.")
    .action(async () => {
      const contract = dependencies.validateOpenApi(await dependencies.fetchOpenApi());
      const requiredScopes = [...READ_OPERATIONS[FIRST_READ_OPERATION][2]];
      let status = await dependencies.status();
      let loginPerformed = false;

      if (!canMakeFirstRead(status, requiredScopes)) {
        await dependencies.login(requiredScopes, execution.stderr);
        loginPerformed = true;
        status = await dependencies.status();
      }

      if (!canMakeFirstRead(status, requiredScopes)) {
        throw new CliError(
          "ONBOARDING_AUTH_UNVERIFIED",
          "Mochi could not verify the required read-only login.",
          ExitCode.Authentication,
        );
      }

      const response = await dependencies.apiGet(buildReadOperationPath(FIRST_READ_OPERATION, {}));
      assertSuccessfulResponse(response);
      execution.complete({
        docsIndexUrl: DOCS_INDEX_URL,
        contract,
        authentication: {
          loginPerformed,
          scopes: [...status.scopes],
          storageBackend: status.storageBackend,
        },
        firstRead: { operation: FIRST_READ_OPERATION, verified: true },
      });
    });
}

function canMakeFirstRead(status: AuthStatus, requiredScopes: readonly string[]): status is AuthenticatedStatus {
  return (
    status.authenticated &&
    status.resource === PUBLIC_API_RESOURCE &&
    requiredScopes.every((scope) => status.scopes.includes(scope))
  );
}

function assertSuccessfulResponse(response: ApiResponse): void {
  if (response.status >= 200 && response.status < 300) return;
  throw new CliError("API_RESPONSE", "The Mochi API returned an unsuccessful response.", ExitCode.Api, {
    status: response.status,
    ...(response.retryAfter === undefined ? {} : { retryAfter: response.retryAfter }),
  });
}
