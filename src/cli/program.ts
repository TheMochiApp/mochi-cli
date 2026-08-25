import { Command, CommanderError } from "commander";

import type { ApiResponse } from "../api/types.js";
import type { AuthStatus } from "../auth/status.js";
import { CliError, ExitCode } from "../core/errors.js";
import { failureJson, successJson, writeResult, type ResultJson } from "../core/output.js";
import type { LoginResult } from "../oauth/login.js";
import type { OpenApiDocument } from "../openapi/types.js";
import type { ReadOperationsValidation } from "../openapi/validate.js";
import type { LogoutResult } from "../auth/logout.js";
import { addAuthCommands } from "./commands/auth.js";
import { addOpenApiCommands } from "./commands/openapi.js";
import { addReadCommands } from "./commands/read.js";

const DOCS_URL = "https://docs.themochi.app/";
const HELP_DATA = {
  commands: [
    "auth login",
    "auth status",
    "auth logout",
    "openapi fetch",
    "openapi validate",
    "leads list",
    "leads get",
    "leads intelligence",
    "signals list",
    "analytics",
    "bookings list",
    "revenue",
    "config",
    "connections list",
    "api get",
  ],
  docsUrl: DOCS_URL,
} as const;

export interface CliRuntimeDependencies {
  login(scopes: readonly string[], stderr: (message: string) => void): Promise<LoginResult>;
  status(): Promise<AuthStatus>;
  logout(localOnly: boolean): Promise<LogoutResult>;
  fetchOpenApi(): Promise<OpenApiDocument>;
  writeOpenApi(document: OpenApiDocument, outputPath: string): Promise<void>;
  validateOpenApi(document: OpenApiDocument): ReadOperationsValidation;
  apiGet(target: string): Promise<ApiResponse>;
}

export interface CliIo {
  writeResult(result: ResultJson<unknown>, exitCode: number): void;
  stderr(message: string): void;
}

export interface ProgramExecution {
  complete(data: unknown): void;
  stderr(message: string): void;
}

export function createProgram(dependencies: CliRuntimeDependencies, execution: ProgramExecution): Command {
  const program = new Command();
  program
    .name("mochi")
    .description("Read Mochi safely from scripts and AI agents.")
    .helpOption(false)
    .allowExcessArguments(false)
    .allowUnknownOption(false)
    .showHelpAfterError(false)
    .showSuggestionAfterError(false)
    .exitOverride()
    .configureOutput({
      writeOut: () => undefined,
      writeErr: () => undefined,
      outputError: () => undefined,
    });

  addAuthCommands(program, dependencies, execution);
  addOpenApiCommands(program, dependencies, execution);
  addReadCommands(program, dependencies, execution);
  return program;
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliRuntimeDependencies,
  io: CliIo = defaultIo,
): Promise<void> {
  let completed = false;
  let data: unknown;
  const execution: ProgramExecution = {
    complete(value) {
      if (completed) throw new CliError("CLI_CONTRACT", "The CLI command completed more than once.", ExitCode.Local);
      completed = true;
      data = value;
    },
    stderr: io.stderr,
  };

  try {
    if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
      execution.complete(HELP_DATA);
    } else {
      await createProgram(dependencies, execution).parseAsync(["node", "mochi", ...argv]);
    }
    if (!completed) throw usageError();
    io.writeResult(successJson(data), ExitCode.Success);
  } catch (error) {
    const cliError = normalizeCliError(error);
    io.writeResult(failureJson(cliError), cliError.exitCode);
  }
}

function normalizeCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof CommanderError) return usageError();
  return new CliError("UNEXPECTED", "The Mochi CLI encountered an unexpected error.", ExitCode.Local);
}

function usageError(): CliError {
  return new CliError("USAGE", "Invalid command. Run mochi --help.", ExitCode.Usage);
}

const defaultIo: CliIo = {
  writeResult,
  stderr(message) {
    process.stderr.write(`${message}\n`);
  },
};
