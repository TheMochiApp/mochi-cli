import type { ReadScope } from "../core/scopes.js";
import { CliError, ExitCode } from "../core/errors.js";

export type ReadOperation = readonly [operationId: string, path: string, requiredScopes: readonly ReadScope[]];

export const READ_OPERATIONS = {
  "leads.list": ["get_public_leads_list", "/v1/leads/", ["leads:read"]],
  "leads.get": ["get_public_lead_detail", "/v1/leads/{lead_id}/", ["leads:read"]],
  "leads.intelligence": [
    "get_public_lead_intelligence",
    "/v1/leads/{lead_id}/intelligence/",
    ["leads:read", "signals:read"],
  ],
  "signals.list": ["get_public_signals_list", "/v1/signals/", ["signals:read"]],
  "bookings.list": ["get_public_bookings_list", "/v1/bookings/", ["bookings:read"]],
  "revenue.transactions": ["get_public_revenue_transactions", "/v1/revenue/transactions/", ["revenue:read"]],
  "revenue.summary": ["get_public_revenue_summary", "/v1/revenue/summary/", ["revenue:read"]],
  "revenue.manual": ["get_public_revenue_manual", "/v1/revenue/manual/", ["revenue:read"]],
  "config.funnels": ["get_public_config_funnels", "/v1/config/funnels/", ["config:read"]],
  "config.tags": ["get_public_config_tags", "/v1/config/tags/", ["config:read"]],
  "connections.list": ["get_public_connections_list", "/v1/connections/", ["config:read"]],
  "analytics.response-times": [
    "get_public_analytics_response_times",
    "/v1/analytics/response-times/",
    ["analytics:read"],
  ],
  "analytics.reply-rate": ["get_public_analytics_reply_rate", "/v1/analytics/reply-rate/", ["analytics:read"]],
  "analytics.funnel": ["get_public_analytics_funnel", "/v1/analytics/funnel/", ["analytics:read"]],
  "analytics.messages": ["get_public_analytics_messages", "/v1/analytics/messages/", ["analytics:read"]],
  "analytics.team": ["get_public_analytics_team", "/v1/analytics/team/", ["analytics:read"]],
  "analytics.links": ["get_public_analytics_links", "/v1/analytics/links/", ["analytics:read"]],
  "analytics.benchmarks": ["get_public_analytics_benchmarks", "/v1/analytics/benchmarks/", ["analytics:read"]],
} as const satisfies Readonly<Record<string, ReadOperation>>;

export type ReadOperationKey = keyof typeof READ_OPERATIONS;

export function buildReadOperationPath(
  operationKey: ReadOperationKey,
  values: Readonly<Record<string, string>> = {},
): string {
  const template = READ_OPERATIONS[operationKey][1];
  const placeholders = [...template.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]!);
  const uniquePlaceholders = new Set(placeholders);
  const suppliedKeys = Object.keys(values);

  if (
    uniquePlaceholders.size !== placeholders.length ||
    suppliedKeys.length !== uniquePlaceholders.size ||
    suppliedKeys.some((key) => !uniquePlaceholders.has(key)) ||
    placeholders.some((key) => !Object.hasOwn(values, key) || values[key]!.length === 0)
  ) {
    throw new CliError("INVALID_PATH_PARAMETERS", `Invalid path parameters for ${operationKey}.`, ExitCode.Usage);
  }

  return template.replace(/\{([^{}]+)\}/gu, (_placeholder, key: string) => encodeURIComponent(values[key]!));
}
