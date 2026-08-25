import { CliError } from "./errors.js";

export interface SuccessJson<T> {
  ok: true;
  data: T;
}

export interface FailureJson {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: {
      status: number;
      retryAfter?: string;
    };
  };
}

export type ResultJson<T> = SuccessJson<T> | FailureJson;

export function successJson<T>(data: T): SuccessJson<T> {
  return { ok: true, data };
}

export function failureJson(error: CliError): FailureJson {
  const status = safeHttpStatus(error.details?.status);
  const retryAfter = safeRetryAfter(error.details?.retryAfter);
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(status === null ? {} : { details: { status, ...(retryAfter === null ? {} : { retryAfter }) } }),
    },
  };
}

export function writeResult(result: ResultJson<unknown>, exitCode: number): void {
  process.stdout.write(`${JSON.stringify(sanitizeErrorValues(result))}\n`);
  process.exitCode = exitCode;
}

function sanitizeErrorValues(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return "[error]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeErrorValues(item, seen));
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }

    seen.add(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeErrorValues(item, seen)]));
  }

  return value;
}

function safeHttpStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeRetryAfter(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^(?:0|[1-9]\d{0,9})$/u.test(value)) return value;
  return /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(
    value,
  )
    ? value
    : null;
}
