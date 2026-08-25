import { Argument, type Command, Option } from "commander";

import { CliError, ExitCode } from "../../core/errors.js";
import { buildReadOperationPath, READ_OPERATIONS, type ReadOperationKey } from "../../commands/registry.js";
import { parseQueryPairs } from "../../commands/query.js";
import type { CliRuntimeDependencies, ProgramExecution } from "../program.js";

const ANALYTICS_METRICS = [
  "response-times",
  "reply-rate",
  "funnel",
  "messages",
  "team",
  "links",
  "benchmarks",
] as const;
const REVENUE_RESOURCES = ["transactions", "summary", "manual"] as const;
const CONFIG_RESOURCES = ["funnels", "tags"] as const;

export function addReadCommands(
  program: Command,
  dependencies: CliRuntimeDependencies,
  execution: ProgramExecution,
): void {
  const leads = program.command("leads").description("Read Mochi leads.");
  addListCommand(leads, "leads.list", dependencies, execution);
  leads
    .command("get")
    .argument("<lead-id>")
    .action(async (leadId: string) => {
      await executeReadOperation("leads.get", { lead_id: leadId }, [], dependencies, execution);
    });
  leads
    .command("intelligence")
    .argument("<lead-id>")
    .action(async (leadId: string) => {
      await executeReadOperation("leads.intelligence", { lead_id: leadId }, [], dependencies, execution);
    });

  const signals = program.command("signals").description("Read Mochi signals.");
  addListCommand(signals, "signals.list", dependencies, execution);

  program
    .command("analytics")
    .addArgument(new Argument("<metric>").choices([...ANALYTICS_METRICS]))
    .action(async (metric: (typeof ANALYTICS_METRICS)[number]) => {
      await executeReadOperation(`analytics.${metric}`, {}, [], dependencies, execution);
    });

  const bookings = program.command("bookings").description("Read Mochi bookings.");
  addListCommand(bookings, "bookings.list", dependencies, execution);

  program
    .command("revenue")
    .addArgument(new Argument("<resource>").choices([...REVENUE_RESOURCES]))
    .action(async (resource: (typeof REVENUE_RESOURCES)[number]) => {
      await executeReadOperation(`revenue.${resource}`, {}, [], dependencies, execution);
    });

  program
    .command("config")
    .addArgument(new Argument("<resource>").choices([...CONFIG_RESOURCES]))
    .action(async (resource: (typeof CONFIG_RESOURCES)[number]) => {
      await executeReadOperation(`config.${resource}`, {}, [], dependencies, execution);
    });

  const connections = program.command("connections").description("Read Mochi connections.");
  addListCommand(connections, "connections.list", dependencies, execution);

  const api = program.command("api").description("Use the same-origin read-only escape hatch.");
  api
    .command("get")
    .argument("<path>")
    .action(async (path: string) => {
      validateRawPath(path);
      execution.complete(await executeApiGet(path, dependencies));
    });
}

function addListCommand(
  parent: Command,
  operationKey: ReadOperationKey,
  dependencies: CliRuntimeDependencies,
  execution: ProgramExecution,
): void {
  parent
    .command("list")
    .addOption(
      new Option("--query <key=value>", "Repeatable query parameter.").argParser(collectValue).default([] as string[]),
    )
    .action(async (options: { query: string[] }) => {
      await executeReadOperation(operationKey, {}, options.query, dependencies, execution);
    });
}

function collectValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function executeReadOperation(
  operationKey: ReadOperationKey,
  pathValues: Readonly<Record<string, string>>,
  queryPairs: readonly string[],
  dependencies: CliRuntimeDependencies,
  execution: ProgramExecution,
): Promise<void> {
  const path = buildReadOperationPath(operationKey, pathValues);
  const query = parseQueryPairs(queryPairs);
  const target = query.size === 0 ? path : `${path}?${query.toString()}`;
  validateRawPath(target);
  const requiredScopes = READ_OPERATIONS[operationKey][2];
  const status = await dependencies.status();
  if (!status.authenticated) {
    throw new CliError("AUTH_REQUIRED", "Run mochi auth login.", ExitCode.Authentication);
  }
  if (requiredScopes.some((scope) => !status.scopes.includes(scope))) {
    throw new CliError("MISSING_SCOPE", "Run mochi auth login with the required read scopes.", ExitCode.Authentication);
  }
  execution.complete(await executeApiGet(target, dependencies));
}

async function executeApiGet(target: string, dependencies: CliRuntimeDependencies): Promise<unknown> {
  const response = await dependencies.apiGet(target);
  if (response.status < 200 || response.status >= 300) {
    throw new CliError("API_RESPONSE", "The Mochi API returned an unsuccessful response.", ExitCode.Api, {
      status: response.status,
      ...(response.retryAfter === undefined ? {} : { retryAfter: response.retryAfter }),
    });
  }
  return response.body;
}

function validateRawPath(path: string): void {
  const rawPath = path.split("?", 1)[0]!;
  if (
    !rawPath.startsWith("/v1/") ||
    rawPath.startsWith("//") ||
    path.includes("#") ||
    rawPath.includes("\\") ||
    /%(?:2e|2f|5c|25)/iu.test(rawPath)
  ) {
    throw new CliError("API_TARGET_INVALID", "API targets must be same-origin relative /v1/ paths.", ExitCode.Usage);
  }
  try {
    const url = new URL(path, "https://api.themochi.app");
    if (url.origin !== "https://api.themochi.app" || !url.pathname.startsWith("/v1/")) throw new Error();
  } catch {
    throw new CliError("API_TARGET_INVALID", "API targets must be same-origin relative /v1/ paths.", ExitCode.Usage);
  }
}
