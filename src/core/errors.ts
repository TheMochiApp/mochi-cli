export const ExitCode = {
  Success: 0,
  Usage: 2,
  Authentication: 3,
  OAuth: 4,
  Network: 5,
  Api: 6,
  Local: 7,
} as const;

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "CliError";
  }
}
