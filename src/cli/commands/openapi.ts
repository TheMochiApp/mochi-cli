import type { Command } from "commander";

import type { CliRuntimeDependencies, ProgramExecution } from "../program.js";

export function addOpenApiCommands(
  program: Command,
  dependencies: CliRuntimeDependencies,
  execution: ProgramExecution,
): void {
  const openapi = program.command("openapi").description("Inspect the published Public API contract.");

  openapi
    .command("fetch")
    .description("Fetch and atomically write the current OpenAPI document.")
    .requiredOption("--output <path>", "Output JSON path.")
    .action(async (options: { output: string }) => {
      const document = await dependencies.fetchOpenApi();
      await dependencies.writeOpenApi(document, options.output);
      execution.complete({ output: options.output });
    });

  openapi
    .command("validate")
    .description("Validate CLI read commands against the published OpenAPI document.")
    .action(async () => {
      execution.complete(dependencies.validateOpenApi(await dependencies.fetchOpenApi()));
    });
}
