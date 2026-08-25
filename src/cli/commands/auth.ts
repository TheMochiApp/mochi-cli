import type { Command } from "commander";

import { normalizeReadScopes } from "../../core/scopes.js";
import type { CliRuntimeDependencies, ProgramExecution } from "../program.js";

export function addAuthCommands(
  program: Command,
  dependencies: CliRuntimeDependencies,
  execution: ProgramExecution,
): void {
  const auth = program.command("auth").description("Authorize this CLI without displaying credentials.");

  auth
    .command("login")
    .description("Authorize read-only access in a browser.")
    .option("--scopes <scopes>", "Comma-separated read-only scopes.")
    .action(async (options: { scopes?: string }) => {
      const scopes = normalizeReadScopes(options.scopes === undefined ? [] : options.scopes.split(","));
      execution.complete(await dependencies.login(scopes, execution.stderr));
    });

  auth
    .command("status")
    .description("Show non-secret authentication status.")
    .action(async () => {
      execution.complete(await dependencies.status());
    });

  auth
    .command("logout")
    .description("Revoke and remove the current login.")
    .option("--local-only", "Remove local credentials without remote revocation.")
    .action(async (options: { localOnly?: boolean }) => {
      execution.complete(await dependencies.logout(options.localOnly === true));
    });
}
