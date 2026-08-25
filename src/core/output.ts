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
  };
}

export type ResultJson<T> = SuccessJson<T> | FailureJson;

export function successJson<T>(data: T): SuccessJson<T> {
  return { ok: true, data };
}

export function failureJson(error: CliError): FailureJson {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
    },
  };
}

export function writeResult(result: ResultJson<unknown>, exitCode: number): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode;
}
